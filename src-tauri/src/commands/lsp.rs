mod documents;
mod helpers;
mod resolve;
mod rpc;
mod typescript;
mod vue_tsserver;

pub use helpers::{
    apply_server_disabled_flag, normalize_lsp_params, server_display_label, LspCatalogEntry,
    LspServerStatus, LspWorkspaceProfile,
};
pub use resolve::{resolve_lsp_servers, LspServerEntry};
pub use typescript::{
    compute_vue_in_play, merge_vue_plugin_options, pick_typescript_tsdk,
    should_inject_vue_typescript_plugin, typescript_lsp_argv,
    typescript_version_supports_native_lsp,
};
pub use vue_tsserver::{tsserver_request_body, unwrap_tsserver_request_tuple};

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
use helpers::{
    install_kind_label, is_managed_install_kind, lsp_method_is_notification, normalize_lsp_method,
    path_to_uri, LspDiagnosticsEvent,
};
use resolve::{load_effective_servers, server_binary_available};
use rpc::{
    ensure_running_server, json_rpc_request, read_lsp_message, respond_to_server_request,
    send_notification, set_state, LspProcess, LSP_SERVERS, LSP_STATES,
};
use typescript::{vue_in_play_for, workspace_configuration_response};
use vue_tsserver::{forward_vue_tsserver_request, mirror_vue_document_to_typescript};

pub(crate) fn spawn_reader(process: Arc<Mutex<LspProcess>>, server_id: String, app: AppHandle) {
    tokio::spawn(async move {
        let stdout = {
            let mut guard = process.lock().await;
            guard.child.stdout.take()
        };

        let Some(stdout) = stdout else {
            return;
        };

        let mut reader = BufReader::new(stdout);
        loop {
            let message = match read_lsp_message(&mut reader).await {
                Ok(message) => message,
                Err(_) => break,
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
                    "client/registerCapability" => serde_json::json!(null),
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
        }

        set_state(
            &server_id,
            false,
            Some("Language server exited".to_string()),
            None,
            Some("exited".to_string()),
        )
        .await;
        let mut servers = LSP_SERVERS.lock().await;
        servers.remove(&server_id);
    });
}

pub(crate) async fn stop_server_internal(server_id: &str) -> Result<(), String> {
    let managed = {
        let mut servers = LSP_SERVERS.lock().await;
        servers.remove(server_id)
    };

    let Some(managed) = managed else {
        set_state(server_id, false, None, None, Some("stopped".to_string())).await;
        return Ok(());
    };

    let process = managed.process.clone();
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

    set_state(server_id, false, None, None, Some("stopped".to_string())).await;
    Ok(())
}

#[tauri::command]
pub async fn lsp_status() -> Result<Vec<LspServerStatus>, String> {
    let states = LSP_STATES.lock().await;
    if states.is_empty() {
        return Ok(vec![]);
    }

    let mut statuses = states.values().cloned().collect::<Vec<_>>();
    statuses.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(statuses)
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
                let lower = pull_error.to_ascii_lowercase();
                if lower.contains("unhandled method")
                    || lower.contains("method not found")
                    || lower.contains("code -32601")
                {
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
) -> Result<LspServerStatus, String> {
    ensure_running_server(&app, &extension, project_root).await
}

#[tauri::command]
pub async fn lsp_stop_server(server_id: String) -> Result<(), String> {
    stop_server_internal(&server_id).await
}

#[tauri::command]
pub async fn lsp_workspace_profile(project_root: String) -> Result<LspWorkspaceProfile, String> {
    let root = std::path::Path::new(&project_root);
    let plan = workspace_warm_plan(root);
    Ok(LspWorkspaceProfile {
        vue_nuxt: workspace_is_vue_nuxt(root),
        warm: plan.server_ids,
        warm_extensions: plan.extensions,
    })
}

#[tauri::command]
pub async fn lsp_catalog(app: AppHandle) -> Result<Vec<LspCatalogEntry>, String> {
    let effective = load_effective_servers(&app).await.unwrap_or_default();
    let states = LSP_STATES.lock().await;
    let mut entries: Vec<LspCatalogEntry> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for spec in builtin_specs() {
        if spec.id == "typescript-classic" {
            continue;
        }
        seen.insert(spec.id.to_string());
        let state = states.get(spec.id);
        let source = install_source_label(&app, spec.id);
        let installed = source != "none";
        let installable = is_managed_install_kind(spec.install);
        let disabled = !effective.contains_key(spec.id);
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
            running: state.map(|s| s.running).unwrap_or(false),
            disabled,
            error: state.and_then(|s| s.error.clone()),
            source: Some(source),
            install_state: state.and_then(|s| s.install_state.clone()).or_else(|| {
                if installed {
                    Some("ready".to_string())
                } else if installable {
                    Some("missing".to_string())
                } else {
                    Some("toolchain".to_string())
                }
            }),
        });
    }

    for (id, entry) in &effective {
        if seen.contains(id) {
            continue;
        }
        let state = states.get(id);
        let source = if server_binary_available(&app, id, entry) {
            "custom".to_string()
        } else {
            "none".to_string()
        };
        entries.push(LspCatalogEntry {
            id: id.clone(),
            label: server_display_label(id),
            extensions: entry.extensions.clone(),
            install_kind: "custom".to_string(),
            requires_trust: false,
            installable: false,
            installed: source != "none",
            running: state.map(|s| s.running).unwrap_or(false),
            disabled: false,
            error: state.and_then(|s| s.error.clone()),
            source: Some(source),
            install_state: state.and_then(|s| s.install_state.clone()),
        });
    }

    entries.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(entries)
}

#[tauri::command]
pub async fn lsp_uninstall_server(app: AppHandle, server_id: String) -> Result<(), String> {
    stop_server_internal(&server_id).await?;
    remove_managed_install(&app, &server_id)?;
    set_state(
        &server_id,
        false,
        None,
        Some("none".to_string()),
        Some("missing".to_string()),
    )
    .await;
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
        stop_server_internal(&server_id).await.ok();
    }

    Ok(())
}
