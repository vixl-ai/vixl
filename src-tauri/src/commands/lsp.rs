mod documents;
mod ensure_running;
mod helpers;
mod install_progress;
mod io;
mod progress;
mod resolve;
mod rpc;
mod start;
mod state;
mod typescript;
mod vue_tsserver;
mod workspace_diagnostics;

pub use documents::forget_open_document;
pub use ensure_running::{acquire_start_lock, start_lock_for, ENSURE_DEADLINE, START_LOCK_WAIT};
pub use helpers::{
    apply_server_disabled_flag, dependent_server_ids, is_lsp_method_not_found,
    normalize_lsp_method, normalize_lsp_params, server_display_label, LspCatalogEntry,
    LspWorkspaceProfile,
};
pub use io::{
    append_stderr_snippet, lsp_invalid_stream_error, lsp_request_timeout_error, read_lsp_message,
};
pub use progress::{
    activity_for_running, clear_loading_activity, parse_progress_params, running_activity_decision,
    server_awaits_project_load, should_emit_progress, ActiveProgress, ProgressKind,
    PROGRESS_REPORT_MIN_INTERVAL_MS, PROJECT_LOAD_FUSE_MS,
};
pub use resolve::{resolve_lsp_servers, LspServerEntry};
pub use rpc::{
    claim_once, classify_process_exit, process_exit_detail, process_exit_status,
    remove_if_generation, LspDiagnosticProvider, ProcessExitStatus,
};
pub use state::{
    apply_transition, LspActivity, LspPhase, LspServerState, LspStatePatch, LspStateWrite,
};
pub use typescript::{
    compute_vue_in_play, merge_vue_plugin_options, pick_typescript_tsdk,
    should_inject_vue_typescript_plugin, typescript_lsp_argv,
    typescript_version_supports_native_lsp,
};
pub use vue_tsserver::{tsserver_request_body, unwrap_tsserver_request_tuple};
pub use workspace_diagnostics::{
    apply_diagnostic_registrations, lsp_workspace_diagnostics, parse_diagnostic_provider,
    parse_workspace_diagnostic_report, ParsedWorkspaceDocumentReport,
};

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::io::BufReader;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use super::config::{load_lsp_config, workspace_is_trusted};
use super::fs::resolve_workspace_path;
use super::lsp_install::{install_source_label, remove_managed_install};
use super::lsp_registry::{builtin_specs, workspace_is_vue_nuxt, workspace_warm_plan};

use documents::{
    close_document, ensure_document_open, sync_document_change, sync_document_change_with_content,
};
use ensure_running::ensure_running_server;
use helpers::{
    install_kind_label, is_managed_install_kind, lsp_method_is_notification, path_to_uri,
    LspDiagnosticsEvent,
};
pub(crate) use install_progress::{finish_standalone_install, mark_server_installing};
use resolve::{load_effective_servers, server_binary_available};
use rpc::{
    cancel_pending_requests, handle_process_exit, json_rpc_request, respond_to_server_request,
    send_notification, LspProcess, LSP_SERVERS,
};
pub(crate) use state::current_generation;
use state::{all_states, fallback_server_state, now_ms, transition, transition_with};
use typescript::{vue_in_play_for, workspace_configuration_response};
use vue_tsserver::{forward_vue_tsserver_request, mirror_vue_document_to_typescript};

pub(crate) async fn commit_running_activity(
    app: &AppHandle,
    server_id: &str,
    generation: u64,
    process: &Mutex<LspProcess>,
) {
    let (progress_activity, project_loading) = {
        let guard = process.lock().await;
        (
            guard.progress.current().cloned(),
            Arc::clone(&guard.project_loading),
        )
    };
    transition_with(app, server_id, generation, move |existing| {
        let activity =
            activity_for_running(progress_activity, project_loading.load(Ordering::SeqCst));
        running_activity_decision(existing, generation, activity)
    })
    .await;
}

pub(crate) fn spawn_reader(
    process: Arc<Mutex<LspProcess>>,
    server_id: String,
    generation: u64,
    app: AppHandle,
) {
    tokio::spawn(async move {
        let stdout = {
            let mut guard = process.lock().await;
            guard.child.stdout.take()
        };

        let Some(stdout) = stdout else {
            handle_process_exit(
                &app,
                &server_id,
                generation,
                &process,
                None,
                Some("LSP stdout unavailable".to_string()),
            )
            .await;
            return;
        };

        let mut reader = BufReader::new(stdout);
        let mut last_progress_emit_ms = None;
        let exit_reason = loop {
            let message = match read_lsp_message(&mut reader).await {
                Ok(message) => message,
                Err(error) => {
                    let _ = cancel_pending_requests(&process, &error).await;
                    break error;
                }
            };

            if message.get("id").is_some() && message.get("method").is_some() {
                let id = message
                    .get("id")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let method = message
                    .get("method")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                let workspace_root = {
                    let guard = process.lock().await;
                    guard.workspace_root.clone()
                };
                let trusted = workspace_is_trusted(&app, Some(workspace_root.as_str()));
                let vue_running =
                    server_id == "vue" || LSP_SERVERS.lock().await.contains_key("vue");
                let vue_in_play = vue_in_play_for(&workspace_root, None, vue_running);
                let result = match method {
                    "window/workDoneProgress/create" => serde_json::json!(null),
                    "client/registerCapability" => {
                        let params = message
                            .get("params")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        {
                            let mut guard = process.lock().await;
                            apply_diagnostic_registrations(&mut guard.diagnostic_provider, &params);
                        }
                        serde_json::json!(null)
                    }
                    "workspace/configuration" => workspace_configuration_response(
                        &app,
                        &message,
                        &workspace_root,
                        trusted,
                        vue_in_play,
                    ),
                    _ => serde_json::json!(null),
                };
                let _ = respond_to_server_request(&process, &id, result).await;
                continue;
            }

            if message.get("id").is_none() {
                if let Some(method) = message.get("method").and_then(|value| value.as_str()) {
                    if method == "$/progress" {
                        if let Some(update) = message.get("params").and_then(parse_progress_params)
                        {
                            let kind = update.kind;
                            {
                                let mut guard = process.lock().await;
                                guard.progress.apply(update);
                            }
                            let now = now_ms();
                            if should_emit_progress(kind, now, last_progress_emit_ms) {
                                commit_running_activity(&app, &server_id, generation, &process)
                                    .await;
                                last_progress_emit_ms = Some(now);
                            }
                        }
                        continue;
                    }

                    if method == "tsserver/request" && server_id == "vue" {
                        let params = message
                            .get("params")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let vue_process = process.clone();
                        let app_handle = app.clone();
                        tokio::spawn(async move {
                            forward_vue_tsserver_request(&app_handle, vue_process, params).await;
                        });
                        continue;
                    }

                    if method == "textDocument/publishDiagnostics" {
                        let params = message
                            .get("params")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let uri = params
                            .get("uri")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let diagnostics = params
                            .get("diagnostics")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!([]));
                        {
                            let mut guard = process.lock().await;
                            guard
                                .diagnostics_by_uri
                                .insert(uri.clone(), diagnostics.clone());
                        }
                        let payload = LspDiagnosticsEvent {
                            uri,
                            diagnostics,
                            server_id: server_id.clone(),
                        };
                        let _ = app.emit("lsp://diagnostics", payload);
                        let loading_done = {
                            let guard = process.lock().await;
                            guard.project_loading.swap(false, Ordering::SeqCst)
                        };
                        if loading_done {
                            commit_running_activity(&app, &server_id, generation, &process).await;
                        }
                    }
                    continue;
                }
            }

            if let Some(id) = message.get("id").and_then(|value| {
                value
                    .as_u64()
                    .or_else(|| value.as_i64().and_then(|v| u64::try_from(v).ok()))
            }) {
                let sender = {
                    let guard = process.lock().await;
                    let mut pending = guard.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(sender) = sender {
                    let _ = sender.send(message);
                }
            }
        };

        handle_process_exit(
            &app,
            &server_id,
            generation,
            &process,
            None,
            Some(exit_reason),
        )
        .await;
    });
}

pub(crate) async fn stop_server_internal(app: &AppHandle, server_id: &str) -> Result<(), String> {
    let managed = {
        let servers = LSP_SERVERS.lock().await;
        servers.get(server_id).cloned()
    };

    let Some(managed) = managed else {
        let generation = current_generation(server_id).await;
        log::info!("stopped {server_id}");
        transition(
            app,
            server_id,
            generation,
            LspPhase::Stopped,
            LspStatePatch::terminal(None),
        )
        .await;
        return Ok(());
    };

    let generation = managed.generation;
    let process = managed.process.clone();
    {
        let guard = process.lock().await;
        guard.stop_requested.store(true, Ordering::SeqCst);
    }

    log::info!("stopping {server_id}");
    transition(
        app,
        server_id,
        generation,
        LspPhase::Stopping,
        LspStatePatch {
            message: Some(None),
            activity: Some(None),
            ..LspStatePatch::default()
        },
    )
    .await;

    let uris = {
        let guard = process.lock().await;
        guard.open_documents.keys().cloned().collect::<Vec<_>>()
    };

    for uri in uris {
        let _ = close_document(&process, &uri).await;
    }

    let _ = json_rpc_request(&process, "shutdown", serde_json::Value::Null).await;
    let _ = send_notification(&process, "exit", serde_json::json!({})).await;

    {
        let mut guard = process.lock().await;
        let _ = guard.child.kill().await;
    }

    {
        let mut servers = LSP_SERVERS.lock().await;
        remove_if_generation(&mut servers, server_id, generation, |entry| {
            entry.generation
        });
    }

    log::info!("stopped {server_id}");
    transition(
        app,
        server_id,
        generation,
        LspPhase::Stopped,
        LspStatePatch::terminal(None),
    )
    .await;
    Ok(())
}

/// Kills a published process without writing a phase.
/// Claims the exit and drops the generation before the kill, so the reader
/// cannot publish over the stored row.
pub(crate) async fn retire_server_process(server_id: &str) {
    let managed = {
        let servers = LSP_SERVERS.lock().await;
        servers.get(server_id).cloned()
    };
    let Some(managed) = managed else {
        return;
    };
    {
        let guard = managed.process.lock().await;
        guard.stop_requested.store(true, Ordering::SeqCst);
        guard.exit_handled.store(true, Ordering::SeqCst);
    }
    {
        let mut servers = LSP_SERVERS.lock().await;
        remove_if_generation(&mut servers, server_id, managed.generation, |entry| {
            entry.generation
        });
    }
    {
        let mut guard = managed.process.lock().await;
        let _ = guard.child.start_kill();
        let _ = guard.child.try_wait();
    }
}

#[tauri::command]
pub async fn lsp_status() -> Result<Vec<LspServerState>, String> {
    Ok(all_states().await)
}

#[tauri::command]
pub async fn lsp_request(
    _app: AppHandle,
    server_id: String,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let method = normalize_lsp_method(&method)?.to_string();

    let managed = {
        let servers = LSP_SERVERS.lock().await;
        servers.get(&server_id).cloned()
    };

    let Some(managed) = managed else {
        return Err("LSP not started".to_string());
    };

    let process = managed.process.clone();
    let workspace_root = {
        let guard = process.lock().await;
        guard.workspace_root.clone()
    };

    if method == "textDocument/didOpen" {
        let path = params
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "path required for textDocument/didOpen".to_string())?;
        let content = params.get("content").and_then(|value| value.as_str());
        let uri = ensure_document_open(&process, &workspace_root, path, content).await?;
        if server_id == "vue" {
            mirror_vue_document_to_typescript(&_app, &workspace_root, path, content, "open").await;
        }
        return Ok(serde_json::json!({ "uri": uri }));
    }

    if method == "textDocument/didChange" {
        let path = params
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "path required for textDocument/didChange".to_string())?;
        let uri = if let Some(content) = params.get("content").and_then(|value| value.as_str()) {
            let uri =
                sync_document_change_with_content(&process, &workspace_root, path, content).await?;
            if server_id == "vue" {
                mirror_vue_document_to_typescript(
                    &_app,
                    &workspace_root,
                    path,
                    Some(content),
                    "change",
                )
                .await;
            }
            uri
        } else {
            let uri = sync_document_change(&process, &workspace_root, path).await?;
            if server_id == "vue" {
                mirror_vue_document_to_typescript(&_app, &workspace_root, path, None, "change")
                    .await;
            }
            uri
        };
        return Ok(serde_json::json!({ "uri": uri }));
    }

    if method == "textDocument/didClose" {
        let path = params
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "path required for textDocument/didClose".to_string())?;
        let absolute = resolve_workspace_path(&workspace_root, path)?;
        let uri = path_to_uri(&absolute);
        close_document(&process, &uri).await?;
        if server_id == "vue" {
            mirror_vue_document_to_typescript(&_app, &workspace_root, path, None, "close").await;
        }
        return Ok(serde_json::json!({ "uri": uri }));
    }

    let mut lsp_params = params;
    if method != "workspace/diagnostic" {
        if let Some(path) = lsp_params
            .get("path")
            .and_then(|value| value.as_str())
            .map(str::to_string)
        {
            let content = lsp_params.get("content").and_then(|value| value.as_str());
            let uri = ensure_document_open(&process, &workspace_root, &path, content).await?;
            if let Some(object) = lsp_params.as_object_mut() {
                object.remove("path");
                if method.starts_with("textDocument/") && !object.contains_key("textDocument") {
                    object.insert(
                        "textDocument".to_string(),
                        serde_json::json!({ "uri": uri }),
                    );
                }
            }
        }
    }

    let lsp_params = normalize_lsp_params(&method, lsp_params)?;

    if lsp_method_is_notification(&method) {
        send_notification(&process, &method, lsp_params).await?;
        return Ok(serde_json::Value::Null);
    }

    if method == "textDocument/diagnostic" {
        let uri = lsp_params
            .get("textDocument")
            .and_then(|text_document| text_document.get("uri"))
            .and_then(|value| value.as_str())
            .map(str::to_string);

        if let Some(uri) = uri.as_ref() {
            for _ in 0..12 {
                {
                    let guard = process.lock().await;
                    if let Some(items) = guard.diagnostics_by_uri.get(uri) {
                        return Ok(serde_json::json!({
                          "kind": "full",
                          "items": items,
                        }));
                    }
                }
                sleep(Duration::from_millis(50)).await;
            }
        }

        match json_rpc_request(&process, &method, lsp_params).await {
            Ok(result) => return Ok(result),
            Err(pull_error) => {
                if let Some(uri) = uri.as_ref() {
                    let guard = process.lock().await;
                    if let Some(items) = guard.diagnostics_by_uri.get(uri) {
                        return Ok(serde_json::json!({
                          "kind": "full",
                          "items": items,
                        }));
                    }
                }
                if is_lsp_method_not_found(&pull_error) {
                    return Ok(serde_json::json!({
                      "kind": "full",
                      "items": [],
                    }));
                }
                return Err(pull_error);
            }
        }
    }

    json_rpc_request(&process, &method, lsp_params).await
}

#[tauri::command]
pub async fn lsp_ensure_server(
    app: AppHandle,
    extension: String,
    project_root: Option<String>,
) -> Result<LspServerState, String> {
    ensure_running_server(&app, &extension, project_root).await
}

#[tauri::command]
pub async fn lsp_stop_server(app: AppHandle, server_id: String) -> Result<(), String> {
    stop_server_internal(&app, &server_id).await
}

#[tauri::command]
pub async fn lsp_workspace_profile(project_root: String) -> Result<LspWorkspaceProfile, String> {
    let root = std::path::PathBuf::from(&project_root);
    let plan = tokio::task::spawn_blocking(move || workspace_warm_plan(&root))
        .await
        .map_err(|error| format!("Workspace warm plan failed: {error}"))?;
    Ok(LspWorkspaceProfile {
        vue_nuxt: workspace_is_vue_nuxt(std::path::Path::new(&project_root)),
        warm: plan.server_ids,
        warm_extensions: plan.extensions,
    })
}

#[tauri::command]
pub async fn lsp_catalog(app: AppHandle) -> Result<Vec<LspCatalogEntry>, String> {
    let effective = load_effective_servers(&app).await.unwrap_or_default();
    let states: HashMap<String, LspServerState> = all_states()
        .await
        .into_iter()
        .map(|state| (state.id.clone(), state))
        .collect();
    let mut entries: Vec<LspCatalogEntry> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for spec in builtin_specs() {
        seen.insert(spec.id.to_string());
        let source = install_source_label(&app, spec.id);
        let installed = source != "none";
        let installable = is_managed_install_kind(spec.install);
        let can_disable = spec.id != "typescript-classic";
        let disabled = if spec.id == "typescript-classic" {
            false
        } else {
            !effective.contains_key(spec.id)
        };
        let state = match states.get(spec.id) {
            Some(state) => state.clone(),
            None => fallback_server_state(spec.id, installed, source),
        };
        entries.push(LspCatalogEntry {
            id: spec.id.to_string(),
            label: server_display_label(spec.id),
            extensions: spec
                .extensions
                .iter()
                .map(|ext| (*ext).to_string())
                .collect(),
            install_kind: install_kind_label(spec.install).to_string(),
            requires_trust: spec.requires_trust,
            installable,
            installed,
            disabled,
            can_disable,
            state,
        });
    }

    for (id, entry) in &effective {
        if seen.contains(id) {
            continue;
        }
        let source = if server_binary_available(&app, id, entry) {
            "custom".to_string()
        } else {
            "none".to_string()
        };
        let installed = source != "none";
        let state = match states.get(id) {
            Some(state) => state.clone(),
            None => fallback_server_state(id, installed, source),
        };
        entries.push(LspCatalogEntry {
            id: id.clone(),
            label: server_display_label(id),
            extensions: entry.extensions.clone(),
            install_kind: "custom".to_string(),
            requires_trust: false,
            installable: false,
            installed,
            disabled: false,
            can_disable: true,
            state,
        });
    }

    entries.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(entries)
}

#[tauri::command]
pub async fn lsp_uninstall_server(app: AppHandle, server_id: String) -> Result<(), String> {
    stop_server_internal(&app, &server_id).await?;
    for extra_id in dependent_server_ids(&server_id) {
        stop_server_internal(&app, extra_id).await?;
    }
    remove_managed_install(&app, &server_id)?;
    let generation = current_generation(&server_id).await;
    let mut patch = LspStatePatch::terminal(None);
    patch.source = Some(Some("none".to_string()));
    patch.workspace_root = Some(None);
    transition(&app, &server_id, generation, LspPhase::Missing, patch).await;
    Ok(())
}

#[tauri::command]
pub async fn lsp_set_server_disabled(
    app: AppHandle,
    server_id: String,
    disabled: bool,
) -> Result<(), String> {
    let mut config = load_lsp_config(&app)?;
    if config.is_null() || config.is_boolean() {
        config = serde_json::json!({});
    }
    let object = config
        .as_object_mut()
        .ok_or_else(|| "lsp.json must be an object to toggle servers".to_string())?;

    apply_server_disabled_flag(object, &server_id, disabled);

    super::config::write_lsp_config_internal(&app, config)?;

    if disabled {
        stop_server_internal(&app, &server_id).await.ok();
    }

    Ok(())
}

#[cfg(all(test, unix))]
mod retire_tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;

    use tokio::sync::Mutex;

    use super::progress::ActiveProgress;
    use super::rpc::{LspProcess, ManagedLspServer, LSP_SERVERS};
    use super::{claim_once, retire_server_process};

    struct Registered {
        id: String,
        process: Arc<Mutex<LspProcess>>,
    }

    impl Drop for Registered {
        fn drop(&mut self) {
            if let Ok(mut guard) = self.process.try_lock() {
                let _ = guard.child.start_kill();
            }
            if let Ok(mut servers) = LSP_SERVERS.try_lock() {
                servers.remove(&self.id);
            }
        }
    }

    #[tokio::test]
    async fn retire_claims_exit_kills_and_writes_no_phase() {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let server_id = format!("retire-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));

        let mut command = tokio::process::Command::new("sleep");
        command
            .arg("30")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().expect("spawn sleep");
        let stdin = child.stdin.take().expect("sleep stdin");
        let generation = 4;
        let process = Arc::new(Mutex::new(LspProcess {
            child,
            stdin,
            workspace_root: "/tmp/app".to_string(),
            open_documents: HashMap::new(),
            diagnostics_by_uri: HashMap::new(),
            diagnostic_provider: None,
            pending: Mutex::new(HashMap::new()),
            next_id: Mutex::new(0),
            uses_classic_typescript: false,
            stderr_tail: Arc::new(Mutex::new(String::new())),
            generation,
            pid: None,
            stop_requested: Arc::new(AtomicBool::new(false)),
            exit_handled: Arc::new(AtomicBool::new(false)),
            progress: ActiveProgress::default(),
            project_loading: Arc::new(AtomicBool::new(false)),
        }));
        let registered = Registered {
            id: server_id.clone(),
            process: process.clone(),
        };
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

        retire_server_process(&server_id).await;

        assert!(
            !LSP_SERVERS.lock().await.contains_key(&server_id),
            "retired generation stays out of the server map"
        );
        assert!(super::state::snapshot(&server_id).await.is_none());

        let guard = process.lock().await;
        assert!(guard.stop_requested.load(Ordering::SeqCst));
        assert!(guard.exit_handled.load(Ordering::SeqCst));
        assert!(
            !claim_once(&guard.exit_handled),
            "reader must not claim the exit after retire"
        );
        drop(guard);

        let mut exited = false;
        for _ in 0..40 {
            let mut guard = process.lock().await;
            if guard.child.try_wait().ok().flatten().is_some() {
                exited = true;
                break;
            }
            drop(guard);
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        assert!(exited, "retired child should be dead");
        drop(registered);
    }
}
