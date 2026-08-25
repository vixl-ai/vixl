use tokio::sync::Mutex;

use super::super::fs::resolve_workspace_path;
use super::super::lsp_registry::language_id_for_extension;
use super::helpers::path_to_uri;
use super::rpc::{send_notification, LspProcess};

pub(crate) async fn ensure_document_open(
    process: &Mutex<LspProcess>,
    workspace_root: &str,
    path: &str,
    content: Option<&str>,
) -> Result<String, String> {
    let absolute = resolve_workspace_path(workspace_root, path)?;
    let uri = path_to_uri(&absolute);

    let needs_open = {
        let guard = process.lock().await;
        !guard.open_documents.contains_key(&uri)
    };

    if !needs_open {
        return Ok(uri);
    }

    let document_content = if let Some(content) = content {
        content.to_string()
    } else {
        std::fs::read_to_string(&absolute).map_err(|error| error.to_string())?
    };
    let extension = absolute
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let language_id = language_id_for_extension(extension);

    let version = 1;

    send_notification(
        process,
        "textDocument/didOpen",
        serde_json::json!({
          "textDocument": {
            "uri": uri,
            "languageId": language_id,
            "version": version,
            "text": document_content,
          }
        }),
    )
    .await?;

    let mut guard = process.lock().await;
    guard.open_documents.insert(uri.clone(), version);

    Ok(uri)
}

pub(crate) async fn sync_document_change(
    process: &Mutex<LspProcess>,
    workspace_root: &str,
    path: &str,
) -> Result<String, String> {
    let absolute = resolve_workspace_path(workspace_root, path)?;
    let content = std::fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
    sync_document_change_with_content(process, workspace_root, path, &content).await
}

pub(crate) async fn sync_document_change_with_content(
    process: &Mutex<LspProcess>,
    workspace_root: &str,
    path: &str,
    content: &str,
) -> Result<String, String> {
    let uri = ensure_document_open(process, workspace_root, path, Some(content)).await?;

    let version = {
        let mut guard = process.lock().await;
        let next_version = guard.open_documents.get(&uri).copied().unwrap_or(0) + 1;
        guard.open_documents.insert(uri.clone(), next_version);
        next_version
    };

    send_notification(
        process,
        "textDocument/didChange",
        serde_json::json!({
          "textDocument": {
            "uri": uri,
            "version": version,
          },
          "contentChanges": [{ "text": content }],
        }),
    )
    .await?;

    Ok(uri)
}

pub(crate) async fn close_document(process: &Mutex<LspProcess>, uri: &str) -> Result<(), String> {
    let should_close = {
        let guard = process.lock().await;
        guard.open_documents.contains_key(uri)
    };

    if !should_close {
        return Ok(());
    }

    send_notification(
        process,
        "textDocument/didClose",
        serde_json::json!({
          "textDocument": { "uri": uri }
        }),
    )
    .await?;

    let mut guard = process.lock().await;
    guard.open_documents.remove(uri);
    guard.diagnostics_by_uri.remove(uri);
    Ok(())
}
