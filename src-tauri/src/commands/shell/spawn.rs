use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::task::JoinHandle;

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

use super::builders::spawn_child;

/// Live tracked shell: wait task owns the Child and listens on `kill_rx`.
/// Kill looks up this entry (so it stays registered until exit) and signals via `kill_tx`.
#[derive(Clone)]
struct TrackedShell {
    kill_tx: tokio::sync::mpsc::Sender<()>,
    exit_rx: tokio::sync::watch::Receiver<Option<ShellExitResult>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExitResult {
    pub exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<i32>,
}

fn shell_exit_from_status(status: std::process::ExitStatus) -> ShellExitResult {
    if let Some(code) = status.code() {
        return ShellExitResult {
            exit_code: code,
            signal: None,
        };
    }

    #[cfg(unix)]
    if let Some(signal) = status.signal() {
        return ShellExitResult {
            exit_code: -1,
            signal: Some(signal),
        };
    }

    ShellExitResult {
        exit_code: -1,
        signal: None,
    }
}

lazy_static::lazy_static! {
  static ref TRACKED_SHELLS: Mutex<HashMap<String, TrackedShell>> =
    Mutex::new(HashMap::new());
}

#[cfg(unix)]
fn kill_process_group(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id() {
        unsafe {
            libc::killpg(pid as i32, libc::SIGTERM);
        }
    }
}

const OUTPUT_PUMP_JOIN_TIMEOUT: Duration = Duration::from_secs(3);

async fn join_output_pumps_with_timeout(
    stdout: JoinHandle<()>,
    stderr: JoinHandle<()>,
    timeout: Duration,
) {
    let stdout_abort = stdout.abort_handle();
    let stderr_abort = stderr.abort_handle();
    if tokio::time::timeout(timeout, async {
        let _ = tokio::join!(stdout, stderr);
    })
    .await
    .is_err()
    {
        stdout_abort.abort();
        stderr_abort.abort();
    }
}

async fn join_output_pumps(stdout: JoinHandle<()>, stderr: JoinHandle<()>) {
    join_output_pumps_with_timeout(stdout, stderr, OUTPUT_PUMP_JOIN_TIMEOUT).await
}

async fn pump_shell_stream(
    app: AppHandle,
    shell_id: String,
    stream: &'static str,
    mut reader: impl AsyncReadExt + Unpin,
) {
    let event_name = format!("shell-output-{shell_id}");
    let mut buffer = [0u8; 4096];

    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(count) => {
                let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                let _ = app.emit(
                    &event_name,
                    serde_json::json!({
                      "shellId": shell_id,
                      "stream": stream,
                      "data": data,
                    }),
                );
            }
            Err(_) => break,
        }
    }
}

async fn recv_tracked_exit(
    mut exit_rx: tokio::sync::watch::Receiver<Option<ShellExitResult>>,
) -> ShellExitResult {
    loop {
        if let Some(exit) = exit_rx.borrow().clone() {
            return exit;
        }
        if exit_rx.changed().await.is_err() {
            return ShellExitResult {
                exit_code: -1,
                signal: None,
            };
        }
    }
}

#[tauri::command]
pub async fn shell_spawn_tracked(
    app: AppHandle,
    shell_id: String,
    project_root: String,
    command: String,
    sandboxed: Option<bool>,
    allow_network: Option<bool>,
    project_writable: Option<bool>,
) -> Result<(), String> {
    let mut child = spawn_child(
        &project_root,
        &command,
        sandboxed,
        allow_network,
        project_writable,
    )?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "stderr unavailable".to_string())?;

    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::channel::<()>(1);
    let (exit_tx, exit_rx) = tokio::sync::watch::channel::<Option<ShellExitResult>>(None);

    TRACKED_SHELLS.lock().unwrap().insert(
        shell_id.clone(),
        TrackedShell {
            kill_tx,
            exit_rx: exit_rx.clone(),
        },
    );

    let app_stdout = app.clone();
    let shell_stdout = shell_id.clone();
    let stdout_task = tokio::spawn(async move {
        pump_shell_stream(app_stdout, shell_stdout, "stdout", stdout).await;
    });

    let app_stderr = app.clone();
    let shell_stderr = shell_id.clone();
    let stderr_task = tokio::spawn(async move {
        pump_shell_stream(app_stderr, shell_stderr, "stderr", stderr).await;
    });

    let app_wait = app.clone();
    let shell_wait = shell_id.clone();
    tokio::spawn(async move {
        // Keep the map entry until exit so kill can find this shell. The wait task
        // owns the Child and handles kill via kill_rx (avoids remove-then-wait race).
        let exit = tokio::select! {
          status = child.wait() => match status {
            Ok(status) => shell_exit_from_status(status),
            Err(_) => ShellExitResult {
              exit_code: -1,
              signal: None,
            },
          },
          kill = kill_rx.recv() => {
            if kill.is_some() {
              #[cfg(unix)]
              kill_process_group(&mut child);
              let _ = child.start_kill();
            }
            match child.wait().await {
              Ok(status) => shell_exit_from_status(status),
              Err(_) => ShellExitResult {
                exit_code: -1,
                signal: None,
              },
            }
          }
        };

        // Drain remaining stdout/stderr before exit so the frontend does not
        // drop the tail when it unregisters listeners on the exit event.
        join_output_pumps(stdout_task, stderr_task).await;

        let _ = exit_tx.send(Some(exit.clone()));
        TRACKED_SHELLS.lock().unwrap().remove(&shell_wait);

        let _ = app_wait.emit(
            &format!("shell-exit-{shell_wait}"),
            serde_json::json!({
              "shellId": shell_wait,
              "exitCode": exit.exit_code,
              "signal": exit.signal,
            }),
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn shell_kill_tracked(shell_id: String) -> Result<ShellExitResult, String> {
    let tracked = {
        let map = TRACKED_SHELLS.lock().unwrap();
        map.get(&shell_id)
            .cloned()
            .ok_or_else(|| "Shell not found".to_string())?
    };

    // Signal the wait task to kill; if the send fails, the wait task already ended
    // and exit_rx should still hold (or soon hold) the result.
    let _ = tracked.kill_tx.send(()).await;

    Ok(recv_tracked_exit(tracked.exit_rx).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Instant;

    #[tokio::test]
    async fn join_output_pumps_waits_for_both_tasks() {
        let finished = Arc::new(AtomicBool::new(false));
        let flag = finished.clone();
        let stdout = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            flag.store(true, Ordering::SeqCst);
        });
        let stderr = tokio::spawn(async {});

        join_output_pumps_with_timeout(stdout, stderr, Duration::from_secs(1)).await;

        assert!(finished.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn join_output_pumps_times_out_hung_pipe() {
        let stdout = tokio::spawn(std::future::pending::<()>());
        let stderr = tokio::spawn(async {});
        let started = Instant::now();

        join_output_pumps_with_timeout(stdout, stderr, Duration::from_millis(50)).await;

        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
