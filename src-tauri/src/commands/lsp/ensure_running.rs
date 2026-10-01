use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::time::timeout;

use super::super::config::workspace_is_trusted;
use super::super::lsp_install::{
    ensure_portable_node, ensure_server_installed, install_source_label, named_lock_for,
};
use super::super::lsp_registry::builtin_spec_by_id;
use super::resolve::{active_project_root, find_server_for_extension, load_effective_servers};
use super::rpc::LSP_SERVERS;
use super::start::{start_server, StartOutcome};
use super::state::{
    current_generation, ephemeral_state, next_generation, snapshot, transition, LspPhase,
    LspServerState, LspStatePatch,
};
use super::typescript::vue_in_play_for;
use super::{retire_server_process, LspServerEntry};

lazy_static::lazy_static! {
  static ref START_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> = Mutex::new(HashMap::new());
}

pub const START_LOCK_WAIT: Duration = Duration::from_secs(60);
pub const ENSURE_DEADLINE: Duration = Duration::from_secs(180);

const WORKSPACE_TRUST_REQUIRED: &str = "Workspace trust required for this language server";

pub async fn start_lock_for(server_id: &str) -> Arc<Mutex<()>> {
    named_lock_for(&START_LOCKS, server_id).await
}

pub async fn acquire_start_lock(server_id: &str, wait: Duration) -> Option<OwnedMutexGuard<()>> {
    let lock = start_lock_for(server_id).await;
    timeout(wait, lock.lock_owned()).await.ok()
}

fn start_in_progress_state(server_id: &str) -> LspServerState {
    let mut state = ephemeral_state(server_id, LspPhase::Starting, 0, None, None);
    state.message = Some(format!("Start already in progress for {server_id}"));
    state
}

pub(crate) async fn ensure_running_server(
    app: &AppHandle,
    extension: &str,
    project_root: Option<String>,
) -> Result<LspServerState, String> {
    ensure_running_server_within(
        app,
        extension,
        project_root,
        START_LOCK_WAIT,
        ENSURE_DEADLINE,
    )
    .await
}

pub(crate) async fn ensure_running_server_within(
    app: &AppHandle,
    extension: &str,
    project_root: Option<String>,
    lock_wait: Duration,
    deadline: Duration,
) -> Result<LspServerState, String> {
    let servers = load_effective_servers(app).await?;

    let workspace_root = project_root
        .or_else(|| active_project_root(app))
        .or_else(|| Some(super::super::paths::get_default_workspace_root()))
        .ok_or_else(|| "No active workspace for LSP".to_string())?;

    let (server_id, entry) =
        find_server_for_extension(app, &servers, extension, Some(workspace_root.as_str()))
            .ok_or_else(|| format!("No LSP server configured for extension: {extension}"))?;

    let _start_guard = match acquire_start_lock(&server_id, lock_wait).await {
        Some(guard) => guard,
        None => {
            log::warn!("start already in progress for {server_id}");
            return Ok(snapshot(&server_id)
                .await
                .unwrap_or_else(|| start_in_progress_state(&server_id)));
        }
    };

    let ensured = timeout(
        deadline,
        ensure_locked(app, &server_id, extension, &workspace_root, entry),
    )
    .await;
    match ensured {
        Ok(result) => result,
        Err(_) => {
            let message = format!("Timed out starting {server_id}");
            log::warn!("{message}");
            Ok(fail_attempt(app, &server_id, message).await)
        }
    }
}

fn stop_owns_row(stored: &LspServerState, generation: u64) -> bool {
    stored.generation >= generation
        && matches!(stored.phase, LspPhase::Stopping | LspPhase::Stopped)
}

async fn ensure_locked(
    app: &AppHandle,
    server_id: &str,
    extension: &str,
    workspace_root: &str,
    entry: LspServerEntry,
) -> Result<LspServerState, String> {
    let vue_running = LSP_SERVERS.lock().await.contains_key("vue");
    let classic_typescript = vue_in_play_for(workspace_root, Some(extension), vue_running);

    if classic_typescript {
        if let Some(managed) = LSP_SERVERS.lock().await.get("typescript").cloned() {
            let uses_classic = {
                let guard = managed.process.lock().await;
                guard.uses_classic_typescript
            };
            if !uses_classic {
                super::stop_server_internal(app, "typescript").await.ok();
            }
        }
    }

    if let Some(spec) = builtin_spec_by_id(server_id) {
        if spec.requires_trust && !workspace_is_trusted(app, Some(workspace_root)) {
            if let Some(managed) = LSP_SERVERS.lock().await.get(server_id).cloned() {
                let running = {
                    let mut guard = managed.process.lock().await;
                    let running = matches!(guard.child.try_wait(), Ok(None));
                    if running {
                        // Claim the exit while the process is still alive. Otherwise the
                        // reader can publish Stopped at this generation after NeedsTrust.
                        guard.exit_handled.store(true, Ordering::SeqCst);
                    }
                    running
                };
                if running {
                    super::stop_server_internal(app, server_id).await.ok();
                }
            }

            // Stop does not bump generation, so this write is still accepted.
            let generation = current_generation(server_id).await;
            let mut patch =
                LspStatePatch::from_error_source(Some(WORKSPACE_TRUST_REQUIRED.to_string()), None);
            patch.message = Some(None);
            patch.pid = Some(None);
            let written = transition(app, server_id, generation, LspPhase::NeedsTrust, patch).await;
            return Ok(adopted(
                server_id,
                written,
                LspPhase::NeedsTrust,
                generation,
                Some(WORKSPACE_TRUST_REQUIRED.to_string()),
                None,
            )
            .await);
        }
    }

    if let Some(managed) = LSP_SERVERS.lock().await.get(server_id).cloned() {
        let (generation, pid, running, current_root, uses_classic) = {
            let mut guard = managed.process.lock().await;
            let running = matches!(guard.child.try_wait(), Ok(None));
            (
                guard.generation,
                guard.pid,
                running,
                guard.workspace_root.clone(),
                guard.uses_classic_typescript,
            )
        };
        let stack_mismatch = server_id == "typescript" && uses_classic != classic_typescript;
        if running && current_root == workspace_root && !stack_mismatch {
            let written = transition(
                app,
                server_id,
                generation,
                LspPhase::Running,
                LspStatePatch::running(
                    install_source_label(app, server_id),
                    workspace_root.to_string(),
                    pid,
                ),
            )
            .await;
            if let Some(state) = written {
                return Ok(state);
            }
            log::info!("retiring {server_id} after a dropped running publish");
            retire_server_process(server_id).await;
            if let Some(state) = snapshot(server_id)
                .await
                .filter(|state| stop_owns_row(state, generation))
            {
                return Ok(state);
            }
        } else if running {
            super::stop_server_internal(app, server_id).await.ok();
        }
    }

    // Bump only when a new process is about to start. Reuse keeps the process generation.
    let generation = next_generation(server_id).await;
    log::info!("starting {server_id} for {extension} in {workspace_root}");
    let source = install_source_label(app, server_id);
    transition(
        app,
        server_id,
        generation,
        LspPhase::Starting,
        LspStatePatch::starting(source, workspace_root.to_string(), None),
    )
    .await;

    let mut note = None;
    let install_id = if server_id == "typescript" && classic_typescript {
        "typescript-classic"
    } else {
        server_id
    };
    record_install(
        &mut note,
        ensure_server_installed(
            app,
            install_id,
            install_generation(server_id, install_id, generation).await,
            install_id != server_id,
        )
        .await,
    );
    if server_id == "vue" {
        let classic_generation = current_generation("typescript-classic").await;
        record_install(
            &mut note,
            ensure_server_installed(app, "typescript-classic", classic_generation, true).await,
        );
    }

    if builtin_spec_by_id(install_id)
        .or_else(|| builtin_spec_by_id(server_id))
        .map(|spec| spec.npm.is_some())
        .unwrap_or(false)
    {
        let _ = ensure_portable_node(app).await;
    }

    let source = install_source_label(app, server_id);
    transition(
        app,
        server_id,
        generation,
        LspPhase::Starting,
        LspStatePatch::starting(source, workspace_root.to_string(), note.clone()),
    )
    .await;

    match start_server(
        server_id.to_string(),
        entry,
        workspace_root.to_string(),
        app.clone(),
        classic_typescript,
        generation,
    )
    .await
    {
        Ok(StartOutcome::Started) => {
            let source = install_source_label(app, server_id);
            Ok(adopted(
                server_id,
                None,
                LspPhase::Running,
                generation,
                None,
                Some(source),
            )
            .await)
        }
        Ok(StartOutcome::Superseded) => {
            Ok(adopted(server_id, None, LspPhase::Stopped, generation, None, None).await)
        }
        Err(error) => {
            let error = match note {
                Some(note) => format!("{note}\n{error}"),
                None => error,
            };
            log::warn!("start failed for {server_id}: {error}");
            Ok(fail_attempt(app, server_id, error).await)
        }
    }
}

async fn install_generation(server_id: &str, install_id: &str, generation: u64) -> u64 {
    if install_id == server_id {
        generation
    } else {
        current_generation(install_id).await
    }
}

fn record_install(note: &mut Option<String>, result: Result<Option<String>, String>) {
    let message = match result {
        Ok(path_fallback) => path_fallback,
        Err(error) => Some(format!("Install failed, trying PATH: {error}")),
    };
    let Some(message) = message else {
        return;
    };
    *note = Some(match note.take() {
        Some(existing) => format!("{existing}\n{message}"),
        None => message,
    });
}

async fn fail_attempt(app: &AppHandle, server_id: &str, error: String) -> LspServerState {
    // Bump first so a reader still exiting this attempt cannot overwrite the Error.
    let generation = next_generation(server_id).await;
    retire_server_process(server_id).await;
    let source = install_source_label(app, server_id);
    let mut patch = LspStatePatch::terminal(Some(error.clone()));
    patch.source = Some(Some(source.clone()));
    let written = transition(app, server_id, generation, LspPhase::Error, patch).await;
    adopted(
        server_id,
        written,
        LspPhase::Error,
        generation,
        Some(error),
        Some(source),
    )
    .await
}

async fn adopted(
    id: &str,
    written: Option<LspServerState>,
    phase: LspPhase,
    generation: u64,
    error: Option<String>,
    source: Option<String>,
) -> LspServerState {
    let stored = match written {
        Some(state) => Some(state),
        None => snapshot(id).await,
    };
    stored.unwrap_or_else(|| ephemeral_state(id, phase, generation, error, source))
}

#[cfg(test)]
mod tests {
    use super::{ephemeral_state, start_in_progress_state, stop_owns_row, LspPhase};

    #[test]
    fn user_stop_owns_the_row_and_a_failure_does_not() {
        let stopped = ephemeral_state("vue", LspPhase::Stopped, 4, None, None);
        assert!(stop_owns_row(&stopped, 4));
        assert!(stop_owns_row(&stopped, 3));
        assert!(!stop_owns_row(&stopped, 5));

        let stopping = ephemeral_state("vue", LspPhase::Stopping, 4, None, None);
        assert!(stop_owns_row(&stopping, 4));

        for phase in [LspPhase::Crashed, LspPhase::Error, LspPhase::Exited] {
            let failed = ephemeral_state("vue", phase, 4, Some("exit 1".to_string()), None);
            assert!(!stop_owns_row(&failed, 4), "{phase:?}");
        }
    }

    #[test]
    fn lock_timeout_without_a_row_is_starting() {
        let state = start_in_progress_state("marksman");
        assert_eq!(state.id, "marksman");
        assert_eq!(state.phase, LspPhase::Starting);
        assert_eq!(state.generation, 0);
        assert_eq!(state.revision, 0);
        assert!(!state.running);
        assert!(state.error.is_none());
        assert_eq!(
            state.message.as_deref(),
            Some("Start already in progress for marksman")
        );
    }
}
