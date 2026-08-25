use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;

use super::super::fs::resolve_workspace_path;
use super::documents::{close_document, ensure_document_open, sync_document_change_with_content};
use super::helpers::path_to_uri;
use super::rpc::{
    ensure_running_server, json_rpc_request, send_notification, LspProcess, LSP_SERVERS,
};
use super::stop_server_internal;

pub fn tsserver_request_body(result: serde_json::Value) -> serde_json::Value {
    result.get("body").cloned().unwrap_or(result)
}

/// Vue LS / vscode-jsonrpc sends array notification params wrapped as a single
/// positional argument: `[[id, command, args]]`. Nvim unwraps the same way.
pub fn unwrap_tsserver_request_tuple(params: &serde_json::Value) -> Option<&[serde_json::Value]> {
    let outer = params.as_array()?;
    if outer.len() == 1 {
        if let Some(inner) = outer[0].as_array() {
            return Some(inner.as_slice());
        }
    }
    Some(outer.as_slice())
}

/// Vue language server v3 hybrid mode: forward `tsserver/request` notifications to
/// typescript-language-server via `typescript.tsserverRequest`, then reply with
/// `tsserver/response`. Without this bridge, Vue features that call into TS hang.
pub(crate) async fn forward_vue_tsserver_request(
    app: &AppHandle,
    vue_process: Arc<Mutex<LspProcess>>,
    params: serde_json::Value,
) {
    let Some(items) = unwrap_tsserver_request_tuple(&params) else {
        return;
    };
    let Some(request_id) = items.first().cloned() else {
        return;
    };
    let command = items
        .get(1)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let args = items.get(2).cloned().unwrap_or(serde_json::Value::Null);

    let body = match forward_vue_tsserver_request_inner(app, &vue_process, &command, args).await {
        Ok(value) => tsserver_request_body(value),
        Err(_) => serde_json::Value::Null,
    };

    // Match Vue/vscode-jsonrpc array-param wrapping used on the request path.
    let _ = send_notification(
        &vue_process,
        "tsserver/response",
        serde_json::json!([[request_id, body]]),
    )
    .await;
}

pub(crate) async fn forward_vue_tsserver_request_inner(
    app: &AppHandle,
    vue_process: &Mutex<LspProcess>,
    command: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if command.is_empty() {
        return Err("empty tsserver command".to_string());
    }

    let workspace_root = {
        let guard = vue_process.lock().await;
        guard.workspace_root.clone()
    };

    let execute = |process: Arc<Mutex<LspProcess>>, command: String, args: serde_json::Value| async move {
        json_rpc_request(
            &process,
            "workspace/executeCommand",
            serde_json::json!({
              "command": "typescript.tsserverRequest",
              "arguments": [command, args]
            }),
        )
        .await
    };

    let _ = ensure_running_server(app, "ts", Some(workspace_root.clone())).await?;

    let ts_managed = {
        let servers = LSP_SERVERS.lock().await;
        servers.get("typescript").cloned()
    }
    .ok_or_else(|| "TypeScript language server is not running".to_string())?;

    let uses_classic = {
        let guard = ts_managed.process.lock().await;
        guard.uses_classic_typescript
    };
    if !uses_classic {
        stop_server_internal("typescript").await.ok();
        let _ = ensure_running_server(app, "ts", Some(workspace_root.clone())).await?;
        let ts_managed = {
            let servers = LSP_SERVERS.lock().await;
            servers.get("typescript").cloned()
        }
        .ok_or_else(|| "TypeScript language server is not running".to_string())?;
        return execute(ts_managed.process.clone(), command.to_string(), args).await;
    }

    match execute(
        ts_managed.process.clone(),
        command.to_string(),
        args.clone(),
    )
    .await
    {
        Ok(value) => Ok(value),
        Err(error) => {
            let lower = error.to_ascii_lowercase();
            let needs_restart = lower.contains("unknown command")
                || lower.contains("tsserverrequest")
                || lower.contains("method not found");
            if !needs_restart {
                return Err(error);
            }

            // Old typescript-language-server builds lack typescript.tsserverRequest.
            stop_server_internal("typescript").await.ok();
            let _ = ensure_running_server(app, "ts", Some(workspace_root)).await?;
            let ts_managed = {
                let servers = LSP_SERVERS.lock().await;
                servers.get("typescript").cloned()
            }
            .ok_or_else(|| "TypeScript language server is not running".to_string())?;
            execute(ts_managed.process.clone(), command.to_string(), args).await
        }
    }
}

pub(crate) async fn mirror_vue_document_to_typescript(
    app: &AppHandle,
    workspace_root: &str,
    path: &str,
    content: Option<&str>,
    op: &str,
) {
    let ts_status = ensure_running_server(app, "ts", Some(workspace_root.to_string())).await;
    if ts_status.map(|status| status.running).unwrap_or(false) == false {
        return;
    }

    let Some(ts_managed) = ({
        let servers = LSP_SERVERS.lock().await;
        servers.get("typescript").cloned()
    }) else {
        return;
    };

    match op {
        "open" | "change" => {
            if let Some(text) = content {
                let _ = sync_document_change_with_content(
                    &ts_managed.process,
                    workspace_root,
                    path,
                    text,
                )
                .await;
            } else {
                let _ = ensure_document_open(&ts_managed.process, workspace_root, path, None).await;
            }
        }
        "close" => {
            if let Ok(absolute) = resolve_workspace_path(workspace_root, path) {
                let uri = path_to_uri(&absolute);
                let _ = close_document(&ts_managed.process, &uri).await;
            }
        }
        _ => {}
    }
}
