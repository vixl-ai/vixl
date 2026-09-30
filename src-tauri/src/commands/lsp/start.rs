use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::super::config::workspace_is_trusted;
use super::super::fs::canonical_project_root;
use super::super::lsp_install::emit_progress;
use super::helpers::path_to_uri;
use super::io::spawn_stderr_tail;
use super::resolve::{resolve_lsp_command, LspServerEntry};
use super::rpc::{
    json_rpc_request, send_notification, set_state, spawn_keepalive, LspProcess, ManagedLspServer,
    LSP_SERVERS,
};
use super::typescript::{build_initialization_options, inject_vue_tsdk_arg};
use super::workspace_diagnostics::parse_diagnostic_provider;

pub(crate) async fn start_server(
    server_id: String,
    entry: LspServerEntry,
    workspace_root: String,
    app: AppHandle,
    classic_typescript: bool,
) -> Result<Arc<Mutex<LspProcess>>, String> {
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
    }));

    super::spawn_reader(process.clone(), server_id.clone(), app.clone());

    let root_uri = path_to_uri(&canonical_project_root(&workspace_root)?);
    let init_options = build_initialization_options(
        &app,
        &server_id,
        &entry.initialization,
        &workspace_root,
        trusted,
        classic_typescript,
    );

    let init_result = json_rpc_request(
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
                restart: Mutex::new(false),
            }),
        );
    }

    spawn_keepalive(server_id.clone(), process.clone());

    set_state(
        &server_id,
        true,
        None,
        Some(resolved.source),
        Some("ready".to_string()),
    )
    .await;
    emit_progress(&app, &server_id, "ready", None);
    Ok(process)
}
