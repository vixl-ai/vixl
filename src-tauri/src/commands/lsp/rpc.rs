use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{sleep, Duration};

use super::super::lsp_install::{with_timeout, LSP_WRITE_TIMEOUT};
use super::helpers::LspServerStatus;

pub(crate) struct LspProcess {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) workspace_root: String,
    pub(crate) open_documents: HashMap<String, i32>,
    pub(crate) diagnostics_by_uri: HashMap<String, serde_json::Value>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    pub(crate) next_id: Mutex<u64>,
    pub(crate) uses_classic_typescript: bool,
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
    let timeout_message = format!("LSP write timed out after {}s", LSP_WRITE_TIMEOUT.as_secs());
    with_timeout(
        LSP_WRITE_TIMEOUT,
        async {
            stdin
                .write_all(header.as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            stdin
                .write_all(&bytes)
                .await
                .map_err(|error| error.to_string())?;
            stdin.flush().await.map_err(|error| error.to_string())
        },
        &timeout_message,
    )
    .await
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
