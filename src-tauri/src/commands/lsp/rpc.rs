use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{sleep, Duration};

use super::super::config::workspace_is_trusted;
use super::super::fs::canonical_project_root;
use super::super::lsp_install::{
    ensure_portable_node, ensure_server_installed, install_source_label,
};
use super::super::lsp_registry::builtin_spec_by_id;
use super::helpers::{path_to_uri, LspServerStatus};
use super::resolve::{
    active_project_root, build_initialization_options, find_server_for_extension,
    inject_vue_tsdk_arg, load_effective_servers, resolve_lsp_command, LspServerEntry,
};

pub(crate) struct LspProcess {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) workspace_root: String,
    pub(crate) open_documents: HashMap<String, i32>,
    pub(crate) diagnostics_by_uri: HashMap<String, serde_json::Value>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    pub(crate) next_id: Mutex<u64>,
}

pub(crate) struct ManagedLspServer {
    pub(crate) process: Arc<Mutex<LspProcess>>,
    pub(crate) restart: Mutex<bool>,
}

lazy_static::lazy_static! {
  pub(crate) static ref LSP_SERVERS: Mutex<HashMap<String, Arc<ManagedLspServer>>> = Mutex::new(HashMap::new());
  pub(crate) static ref LSP_STATES: Mutex<HashMap<String, LspServerStatus>> = Mutex::new(HashMap::new());
}

pub(crate) async fn set_state(
    id: &str,
    running: bool,
    error: Option<String>,
    source: Option<String>,
    install_state: Option<String>,
) {
    let mut states = LSP_STATES.lock().await;
    let existing = states.get(id).cloned();
    states.insert(
        id.to_string(),
        LspServerStatus {
            id: id.to_string(),
            running,
            error,
            source: source.or(existing.as_ref().and_then(|s| s.source.clone())),
            install_state: install_state
                .or(existing.as_ref().and_then(|s| s.install_state.clone())),
        },
    );
}

pub(crate) async fn write_lsp_message(
    stdin: &mut ChildStdin,
    body: &serde_json::Value,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(body).map_err(|error| error.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    stdin
        .write_all(header.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stdin
        .write_all(&bytes)
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

pub(crate) async fn read_lsp_message(
    reader: &mut BufReader<ChildStdout>,
) -> Result<serde_json::Value, String> {
    let mut header = Vec::new();
    let mut byte = [0u8; 1];

    loop {
        reader
            .read_exact(&mut byte)
            .await
            .map_err(|error| error.to_string())?;
        header.push(byte[0]);
        if header.len() >= 4 && header.ends_with(b"\r\n\r\n") {
            break;
        }
        if header.len() > 8192 {
            return Err("Invalid LSP header".to_string());
        }
    }

    let header_text = String::from_utf8_lossy(&header);
    let mut content_length = None;
    for line in header_text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("Content-Length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }

    let content_length =
        content_length.ok_or_else(|| "Missing Content-Length header".to_string())?;
    let mut body = vec![0u8; content_length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

pub(crate) async fn send_notification(
    process: &Mutex<LspProcess>,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let message = serde_json::json!({
      "jsonrpc": "2.0",
      "method": method,
      "params": params,
    });

    let mut guard = process.lock().await;
    write_lsp_message(&mut guard.stdin, &message).await
}

pub(crate) async fn json_rpc_request(
    process: &Mutex<LspProcess>,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let timeout_secs = match method {
        "textDocument/hover"
        | "textDocument/definition"
        | "textDocument/references"
        | "textDocument/completion"
        | "textDocument/documentSymbol"
        | "workspace/symbol" => 12u64,
        _ => 30u64,
    };

    let id = {
        let guard = process.lock().await;
        let mut next = guard.next_id.lock().await;
        *next += 1;
        *next
    };

    let (tx, rx) = oneshot::channel();
    {
        let guard = process.lock().await;
        guard.pending.lock().await.insert(id, tx);
    }

    let message = serde_json::json!({
      "jsonrpc": "2.0",
      "id": id,
      "method": method,
      "params": params,
    });

    {
        let mut guard = process.lock().await;
        write_lsp_message(&mut guard.stdin, &message).await?;
    }

    let response = match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => return Err("LSP request cancelled".to_string()),
        Err(_) => {
            let guard = process.lock().await;
            guard.pending.lock().await.remove(&id);
            return Err(format!(
                "LSP request timed out after {timeout_secs}s ({method})"
            ));
        }
    };

    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("LSP request failed");
        let code = error
            .get("code")
            .and_then(|value| value.as_i64())
            .map(|code| format!(" (code {code})"))
            .unwrap_or_default();
        return Err(format!("{message}{code}"));
    }

    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

pub(crate) async fn respond_to_server_request(
    process: &Mutex<LspProcess>,
    id: &serde_json::Value,
    result: serde_json::Value,
) -> Result<(), String> {
    let message = serde_json::json!({
      "jsonrpc": "2.0",
      "id": id,
      "result": result,
    });
    let mut guard = process.lock().await;
    write_lsp_message(&mut guard.stdin, &message).await
}

pub(crate) fn spawn_keepalive(server_id: String, process: Arc<Mutex<LspProcess>>) {
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(5)).await;
            let exited = {
                let mut guard = process.lock().await;
                match guard.child.try_wait() {
                    Ok(Some(_)) => true,
                    Ok(None) => false,
                    Err(_) => true,
                }
            };

            if exited {
                set_state(
                    &server_id,
                    false,
                    Some("Language server crashed".to_string()),
                    None,
                    Some("crashed".to_string()),
                )
                .await;
                let servers = LSP_SERVERS.lock().await;
                if let Some(managed) = servers.get(&server_id) {
                    let mut restart = managed.restart.lock().await;
                    *restart = true;
                }
                break;
            }
        }
    });
}

pub(crate) async fn start_server(
    server_id: String,
    entry: LspServerEntry,
    workspace_root: String,
    app: AppHandle,
) -> Result<Arc<Mutex<LspProcess>>, String> {
    let trusted = workspace_is_trusted(&app, Some(workspace_root.as_str()));
    let mut resolved = resolve_lsp_command(&app, &server_id, &entry, &workspace_root, trusted)?;
    inject_vue_tsdk_arg(&app, &server_id, &workspace_root, trusted, &mut resolved);

    let mut command = Command::new(&resolved.program);
    command
        .args(&resolved.args)
        .current_dir(&workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    for (key, value) in &entry.env {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Failed to start LSP '{server_id}' ({resolved_program}): {error}",
            resolved_program = resolved.program
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "LSP stdin unavailable".to_string())?;

    let process = Arc::new(Mutex::new(LspProcess {
        child,
        stdin,
        workspace_root: workspace_root.clone(),
        open_documents: HashMap::new(),
        diagnostics_by_uri: HashMap::new(),
        pending: Mutex::new(HashMap::new()),
        next_id: Mutex::new(0),
    }));

    super::spawn_reader(process.clone(), server_id.clone(), app.clone());
    spawn_keepalive(server_id.clone(), process.clone());

    let root_uri = path_to_uri(&canonical_project_root(&workspace_root)?);
    let init_options = build_initialization_options(
        &app,
        &server_id,
        &entry.initialization,
        &workspace_root,
        trusted,
    );

    json_rpc_request(
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
                "dynamicRegistration": false,
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
              "references": {},
              "documentSymbol": {
                "hierarchicalDocumentSymbolSupport": true
              }
            },
            "workspace": {
              "configuration": true,
              "workspaceFolders": true,
              "symbol": {}
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
    .await?;

    send_notification(&process, "initialized", serde_json::json!({})).await?;

    {
        let mut servers = LSP_SERVERS.lock().await;
        servers.insert(
            server_id.clone(),
            Arc::new(ManagedLspServer {
                process: process.clone(),
                restart: Mutex::new(false),
            }),
        );
    }

    set_state(
        &server_id,
        true,
        None,
        Some(resolved.source),
        Some("ready".to_string()),
    )
    .await;
    Ok(process)
}

pub(crate) async fn ensure_running_server(
    app: &AppHandle,
    extension: &str,
    project_root: Option<String>,
) -> Result<LspServerStatus, String> {
    let servers = load_effective_servers(app).await?;

    let workspace_root = project_root
        .or_else(|| active_project_root(app))
        .or_else(|| Some(super::super::paths::get_default_workspace_root()))
        .ok_or_else(|| "No active workspace for LSP".to_string())?;

    let (server_id, entry) =
        find_server_for_extension(app, &servers, extension, Some(workspace_root.as_str()))
            .ok_or_else(|| format!("No LSP server configured for extension: {extension}"))?;

    if let Some(spec) = builtin_spec_by_id(&server_id) {
        if spec.requires_trust {
            if !workspace_is_trusted(app, Some(workspace_root.as_str())) {
                return Ok(LspServerStatus {
                    id: server_id,
                    running: false,
                    error: Some("Workspace trust required for this language server".to_string()),
                    source: Some("none".to_string()),
                    install_state: Some("needs_trust".to_string()),
                });
            }
        }
    }

    set_state(
        &server_id,
        false,
        None,
        Some(install_source_label(app, &server_id)),
        Some("starting".to_string()),
    )
    .await;

    match ensure_server_installed(app, &server_id).await {
        Ok(_) => {}
        Err(error) => {
            set_state(
                &server_id,
                false,
                Some(error.clone()),
                Some(install_source_label(app, &server_id)),
                Some("error".to_string()),
            )
            .await;
            // Continue: PATH fallback may still work inside resolve_lsp_command
            let _ = error;
        }
    }

    // Warm portable node for npm-backed servers
    if builtin_spec_by_id(&server_id)
        .map(|s| s.npm.is_some())
        .unwrap_or(false)
    {
        let _ = ensure_portable_node(app).await;
    }

    if let Some(managed) = LSP_SERVERS.lock().await.get(&server_id).cloned() {
        let (should_restart, current_root) = {
            let restart = managed.restart.lock().await;
            let guard = managed.process.lock().await;
            (*restart, guard.workspace_root.clone())
        };

        if current_root != workspace_root {
            super::stop_server_internal(&server_id).await.ok();
        } else if !should_restart {
            let running = {
                let mut guard = managed.process.lock().await;
                guard.child.try_wait().ok().flatten().is_none()
            };

            if running {
                set_state(
                    &server_id,
                    true,
                    None,
                    Some(install_source_label(app, &server_id)),
                    Some("ready".to_string()),
                )
                .await;
                return Ok(LspServerStatus {
                    id: server_id.clone(),
                    running: true,
                    error: None,
                    source: Some(install_source_label(app, &server_id)),
                    install_state: Some("ready".to_string()),
                });
            }
        } else {
            super::stop_server_internal(&server_id).await.ok();
        }
    }

    match start_server(server_id.clone(), entry, workspace_root, app.clone()).await {
        Ok(_) => Ok(LspServerStatus {
            id: server_id.clone(),
            running: true,
            error: None,
            source: Some(install_source_label(app, &server_id)),
            install_state: Some("ready".to_string()),
        }),
        Err(error) => {
            set_state(
                &server_id,
                false,
                Some(error.clone()),
                Some(install_source_label(app, &server_id)),
                Some("error".to_string()),
            )
            .await;
            Ok(LspServerStatus {
                id: server_id,
                running: false,
                error: Some(error),
                source: Some("none".to_string()),
                install_state: Some("error".to_string()),
            })
        }
    }
}
