use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::super::config::workspace_is_trusted;
use super::super::fs::canonical_project_root;
use super::helpers::path_to_uri;
use super::io::spawn_stderr_tail;
use super::progress::{
    activity_for_running, clear_loading_activity, server_awaits_project_load, ActiveProgress,
    PROJECT_LOAD_FUSE_MS,
};
use super::resolve::{resolve_lsp_command, LspServerEntry};
use super::rpc::{
    json_rpc_request, send_notification, spawn_keepalive, LspProcess, ManagedLspServer, LSP_SERVERS,
};
use super::state::{transition, transition_with, LspActivity, LspPhase, LspStatePatch};
use super::typescript::{build_initialization_options, inject_vue_tsdk_arg};
use super::workspace_diagnostics::parse_diagnostic_provider;

pub(crate) enum StartOutcome {
    Started,
    /// Running was dropped and the process was retired. The stored phase stays.
    Superseded,
}

pub(crate) async fn start_server(
    server_id: String,
    entry: LspServerEntry,
    workspace_root: String,
    app: AppHandle,
    classic_typescript: bool,
    generation: u64,
) -> Result<StartOutcome, String> {
    let trusted = workspace_is_trusted(&app, Some(workspace_root.as_str()));
    let mut resolved = resolve_lsp_command(
        &app,
        &server_id,
        &entry,
        &workspace_root,
        trusted,
        classic_typescript,
    )?;
    inject_vue_tsdk_arg(
        &app,
        &server_id,
        &workspace_root,
        trusted,
        &mut resolved.args,
    );

    let mut command = Command::new(&resolved.program);
    command
        .args(&resolved.args)
        .current_dir(&workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    for (key, value) in &entry.env {
        command.env(key, value);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!(
                "Failed to start LSP '{server_id}' ({resolved_program}): {error}",
                resolved_program = resolved.program
            );
            log::warn!("spawn failed for {server_id}: {message}");
            return Err(message);
        }
    };
    let pid = child.id();
    match pid {
        Some(pid) => log::info!("spawned {server_id} pid {pid}"),
        None => log::info!("spawned {server_id}"),
    }
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "LSP stdin unavailable".to_string())?;
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        spawn_stderr_tail(stderr, stderr_tail.clone());
    }

    let process = Arc::new(Mutex::new(LspProcess {
        child,
        stdin,
        workspace_root: workspace_root.clone(),
        open_documents: HashMap::new(),
        diagnostics_by_uri: HashMap::new(),
        diagnostic_provider: None,
        pending: Mutex::new(HashMap::new()),
        next_id: Mutex::new(0),
        uses_classic_typescript: server_id == "typescript" && classic_typescript,
        stderr_tail,
        generation,
        pid,
        stop_requested: Arc::new(AtomicBool::new(false)),
        exit_handled: Arc::new(AtomicBool::new(false)),
        progress: ActiveProgress::default(),
        project_loading: Arc::new(AtomicBool::new(server_awaits_project_load(&server_id))),
    }));
    // kill_on_drop does not run while the reader still holds this process.
    let mut child_guard = ChildGuard {
        process: process.clone(),
        published: false,
    };

    super::spawn_reader(process.clone(), server_id.clone(), generation, app.clone());

    let root_uri = path_to_uri(&canonical_project_root(&workspace_root)?);
    let init_options = build_initialization_options(
        &app,
        &server_id,
        &entry.initialization,
        &workspace_root,
        trusted,
        classic_typescript,
    );

    let init_result = match json_rpc_request(
        &process,
        "initialize",
        serde_json::json!({
          "processId": std::process::id(),
          "rootPath": workspace_root,
          "rootUri": root_uri,
          "capabilities": {
            "textDocument": {
              "synchronization": {
                "dynamicRegistration": false,
                "didSave": false,
                "willSave": false,
                "willSaveWaitUntil": false
              },
              "publishDiagnostics": {},
              "diagnostic": {
                "dynamicRegistration": true,
                "relatedDocumentSupport": false
              },
              "hover": {
                "contentFormat": ["markdown", "plaintext"]
              },
              "completion": {
                "completionItem": {
                  "snippetSupport": true,
                  "documentationFormat": ["markdown", "plaintext"]
                }
              },
              "definition": { "linkSupport": true },
              "formatting": {
                "dynamicRegistration": false
              },
              "references": {},
              "documentSymbol": {
                "hierarchicalDocumentSymbolSupport": true
              }
            },
            "workspace": {
              "configuration": true,
              "workspaceFolders": true,
              "symbol": {},
              "diagnostics": {
                "refreshSupport": false
              }
            },
            "window": {
              "workDoneProgress": true
            }
          },
          "initializationOptions": init_options,
          "trace": "off",
          "workspaceFolders": [{
            "uri": root_uri,
            "name": Path::new(&workspace_root)
              .file_name()
              .and_then(|name| name.to_str())
              .unwrap_or("workspace")
          }]
        }),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            log::warn!("initialize failed for {server_id}: {error}");
            return Err(error);
        }
    };

    {
        let mut guard = process.lock().await;
        guard.diagnostic_provider = parse_diagnostic_provider(&init_result);
    }

    send_notification(&process, "initialized", serde_json::json!({})).await?;

    {
        let mut servers = LSP_SERVERS.lock().await;
        servers.insert(
            server_id.clone(),
            Arc::new(ManagedLspServer {
                process: process.clone(),
                generation,
            }),
        );
    }
    child_guard.published = true;

    spawn_keepalive(app.clone(), server_id.clone(), generation, process.clone());

    let still_alive = {
        let mut guard = process.lock().await;
        matches!(guard.child.try_wait(), Ok(None))
    };
    if !still_alive {
        return Err(format!(
            "Language server exited during startup ({server_id})"
        ));
    }

    let activity = current_running_activity(&process).await;
    let mut patch = LspStatePatch::running(resolved.source, workspace_root, pid);
    patch.activity = Some(activity.clone());
    let published = transition(&app, &server_id, generation, LspPhase::Running, patch).await;
    if published.is_none() {
        log::info!("retiring {server_id} after a dropped running publish");
        super::retire_server_process(&server_id).await;
        return Ok(StartOutcome::Superseded);
    }
    let latest = current_running_activity(&process).await;
    if latest != activity {
        super::commit_running_activity(&app, &server_id, generation, &process).await;
    }
    if server_awaits_project_load(&server_id) {
        let project_loading = {
            let guard = process.lock().await;
            Arc::clone(&guard.project_loading)
        };
        if project_loading.load(Ordering::SeqCst) {
            spawn_project_load_fuse(app.clone(), server_id.clone(), generation, project_loading);
        }
    }
    Ok(StartOutcome::Started)
}

async fn current_running_activity(process: &Mutex<LspProcess>) -> Option<LspActivity> {
    let guard = process.lock().await;
    activity_for_running(
        guard.progress.current().cloned(),
        guard.project_loading.load(Ordering::SeqCst),
    )
}

fn spawn_project_load_fuse(
    app: AppHandle,
    server_id: String,
    generation: u64,
    project_loading: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(PROJECT_LOAD_FUSE_MS)).await;
        if !project_loading.swap(false, Ordering::SeqCst) {
            return;
        }
        // A live $/progress token stays. Only the loading sentinel is cleared.
        transition_with(&app, &server_id, generation, move |existing| {
            clear_loading_activity(existing, generation)
        })
        .await;
    });
}

struct ChildGuard {
    process: Arc<Mutex<LspProcess>>,
    published: bool,
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        kill_held_child(&self.process);
    }
}

fn kill_held_child(process: &Arc<Mutex<LspProcess>>) {
    if let Ok(mut guard) = process.try_lock() {
        let _ = guard.child.start_kill();
        return;
    }
    let process = Arc::clone(process);
    drop(tokio::spawn(async move {
        let mut guard = process.lock().await;
        let _ = guard.child.start_kill();
    }));
}
