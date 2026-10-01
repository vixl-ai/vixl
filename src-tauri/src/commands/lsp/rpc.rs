use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{sleep, Duration};

use super::super::lsp_install::{with_timeout, LSP_WRITE_TIMEOUT};
use super::io::{append_stderr_snippet, lsp_request_timeout_error};
use super::progress::ActiveProgress;
use super::state::{transition_with, LspPhase, LspStatePatch};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LspDiagnosticProvider {
    pub workspace_diagnostics: bool,
    pub identifier: Option<String>,
}

pub(crate) struct LspProcess {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) workspace_root: String,
    pub(crate) open_documents: HashMap<String, i32>,
    pub(crate) diagnostics_by_uri: HashMap<String, serde_json::Value>,
    pub(crate) diagnostic_provider: Option<LspDiagnosticProvider>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    pub(crate) next_id: Mutex<u64>,
    pub(crate) uses_classic_typescript: bool,
    pub(crate) stderr_tail: Arc<Mutex<String>>,
    /// Generation captured when this process was spawned.
    pub(crate) generation: u64,
    pub(crate) pid: Option<u32>,
    pub(crate) stop_requested: Arc<AtomicBool>,
    pub(crate) exit_handled: Arc<AtomicBool>,
    pub(crate) progress: ActiveProgress,
    /// Vue and TypeScript: set until the first diagnostics publish or the 20s fuse.
    pub(crate) project_loading: Arc<AtomicBool>,
}

pub(crate) struct ManagedLspServer {
    pub(crate) process: Arc<Mutex<LspProcess>>,
    pub(crate) generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessExitStatus {
    Code(i32),
    Signal(i32),
    Unknown,
}

pub fn process_exit_status(code: Option<i32>, signal: Option<i32>) -> ProcessExitStatus {
    if let Some(code) = code {
        return ProcessExitStatus::Code(code);
    }
    if let Some(signal) = signal {
        return ProcessExitStatus::Signal(signal);
    }
    ProcessExitStatus::Unknown
}

pub fn classify_process_exit(stop_requested: bool, status: ProcessExitStatus) -> LspPhase {
    if stop_requested {
        return LspPhase::Stopped;
    }
    match status {
        ProcessExitStatus::Code(0) => LspPhase::Exited,
        _ => LspPhase::Crashed,
    }
}

pub fn process_exit_detail(
    status: ProcessExitStatus,
    stderr: &str,
    context: Option<&str>,
) -> Option<String> {
    if matches!(status, ProcessExitStatus::Code(0)) {
        return None;
    }
    let base = match status {
        ProcessExitStatus::Code(code) => format!("Language server crashed (exit {code})"),
        ProcessExitStatus::Signal(signal) => format!("Language server crashed (signal {signal})"),
        ProcessExitStatus::Unknown => {
            match context.map(str::trim).filter(|text| !text.is_empty()) {
                Some(text) => format!("Language server crashed: {text}"),
                None => "Language server crashed".to_string(),
            }
        }
    };
    Some(append_stderr_snippet(base, stderr))
}

pub fn claim_once(flag: &AtomicBool) -> bool {
    !flag.swap(true, Ordering::SeqCst)
}

pub fn remove_if_generation<T>(
    servers: &mut HashMap<String, T>,
    id: &str,
    generation: u64,
    generation_of: impl FnOnce(&T) -> u64,
) -> bool {
    let Some(current) = servers.get(id) else {
        return false;
    };
    if generation_of(current) != generation {
        return false;
    }
    servers.remove(id);
    true
}

fn status_from_std(status: &std::process::ExitStatus) -> ProcessExitStatus {
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    };
    #[cfg(not(unix))]
    let signal = None;
    process_exit_status(status.code(), signal)
}

lazy_static::lazy_static! {
  pub(crate) static ref LSP_SERVERS: Mutex<HashMap<String, Arc<ManagedLspServer>>> = Mutex::new(HashMap::new());
}

async fn stderr_snapshot(process: &Mutex<LspProcess>) -> String {
    let tail = {
        let guard = process.lock().await;
        guard.stderr_tail.clone()
    };
    let text = tail.lock().await.clone();
    text
}

async fn clear_pending(process: &Mutex<LspProcess>, id: u64) {
    let guard = process.lock().await;
    guard.pending.lock().await.remove(&id);
}

pub(crate) async fn cancel_pending_requests(process: &Mutex<LspProcess>, reason: &str) -> String {
    let stderr = stderr_snapshot(process).await;
    let message = append_stderr_snippet(reason.to_string(), &stderr);
    let senders: Vec<_> = {
        let guard = process.lock().await;
        let mut pending = guard.pending.lock().await;
        pending.drain().map(|(_, sender)| sender).collect()
    };
    let payload = serde_json::json!({ "error": { "message": message } });
    for sender in senders {
        let _ = sender.send(payload.clone());
    }
    message
}

async fn wait_until_child_exits(process: &Mutex<LspProcess>) {
    loop {
        {
            let mut guard = process.lock().await;
            match guard.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => {}
                Err(_) => return,
            }
        }
        sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_rpc_response(
    process: &Mutex<LspProcess>,
    rx: oneshot::Receiver<serde_json::Value>,
    id: u64,
    method: &str,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    tokio::select! {
        biased;
        result = rx => match result {
            Ok(response) => Ok(response),
            Err(_) => {
                let stderr = stderr_snapshot(process).await;
                Err(append_stderr_snippet(
                    "LSP request cancelled".to_string(),
                    &stderr,
                ))
            }
        },
        _ = wait_until_child_exits(process) => {
            clear_pending(process, id).await;
            let stderr = stderr_snapshot(process).await;
            Err(append_stderr_snippet(
                format!("Language server exited while waiting for {method}"),
                &stderr,
            ))
        },
        _ = sleep(Duration::from_secs(timeout_secs)) => {
            clear_pending(process, id).await;
            let stderr = stderr_snapshot(process).await;
            Err(append_stderr_snippet(
                lsp_request_timeout_error(timeout_secs, method),
                &stderr,
            ))
        }
    }
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
        "workspace/diagnostic" => 60u64,
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
        if let Err(error) = write_lsp_message(&mut guard.stdin, &message).await {
            guard.pending.lock().await.remove(&id);
            let tail = guard.stderr_tail.clone();
            drop(guard);
            let stderr = tail.lock().await.clone();
            return Err(append_stderr_snippet(error, &stderr));
        }
    }

    let response = wait_for_rpc_response(process, rx, id, method, timeout_secs).await?;

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

pub(crate) fn spawn_keepalive(
    app: AppHandle,
    server_id: String,
    generation: u64,
    process: Arc<Mutex<LspProcess>>,
) {
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(5)).await;
            let status = {
                let mut guard = process.lock().await;
                match guard.child.try_wait() {
                    Ok(Some(status)) => Some(status),
                    Ok(None) => continue,
                    Err(_) => None,
                }
            };
            handle_process_exit(
                &app,
                &server_id,
                generation,
                &process,
                status.as_ref(),
                None,
            )
            .await;
            break;
        }
    });
}

async fn wait_child_status(process: &Mutex<LspProcess>) -> Option<std::process::ExitStatus> {
    for _ in 0..20 {
        {
            let mut guard = process.lock().await;
            match guard.child.try_wait() {
                Ok(Some(status)) => return Some(status),
                Ok(None) => {}
                Err(_) => return None,
            }
        }
        sleep(Duration::from_millis(25)).await;
    }
    {
        let mut guard = process.lock().await;
        let _ = guard.child.start_kill();
    }
    sleep(Duration::from_millis(50)).await;
    let mut guard = process.lock().await;
    guard.child.try_wait().ok().flatten()
}

pub(crate) async fn handle_process_exit(
    app: &AppHandle,
    server_id: &str,
    generation: u64,
    process: &Arc<Mutex<LspProcess>>,
    known_status: Option<&std::process::ExitStatus>,
    context: Option<String>,
) {
    let (exit_handled, stop_requested) = {
        let guard = process.lock().await;
        (guard.exit_handled.clone(), guard.stop_requested.clone())
    };
    if exit_handled.load(Ordering::SeqCst) {
        return;
    }

    let status = match known_status {
        Some(status) => status_from_std(status),
        None => match wait_child_status(process).await.as_ref() {
            Some(status) => status_from_std(status),
            None => ProcessExitStatus::Unknown,
        },
    };

    // Only the matching generation is removed. A miss means this process was never
    // published or a newer one replaced it, so the exit must not be written.
    let removed = {
        let mut servers = LSP_SERVERS.lock().await;
        remove_if_generation(&mut servers, server_id, generation, |managed| {
            managed.generation
        })
    };
    if !removed || !claim_once(&exit_handled) {
        return;
    }

    let stderr = stderr_snapshot(process).await;
    let crash = process_exit_detail(status, &stderr, context.as_deref());
    let written = transition_with(app, server_id, generation, move |_existing| {
        let phase = classify_process_exit(stop_requested.load(Ordering::SeqCst), status);
        let error = if phase == LspPhase::Crashed {
            crash.clone()
        } else {
            None
        };
        Some((phase, LspStatePatch::terminal(error)))
    })
    .await;

    if let Some(state) = written.as_ref() {
        match state.phase {
            LspPhase::Exited => log::info!("exited {server_id}"),
            LspPhase::Crashed => {
                log::warn!(
                    "crashed {server_id}: {}",
                    state.error.as_deref().unwrap_or("Language server crashed")
                );
            }
            _ => {}
        }
    }
}
