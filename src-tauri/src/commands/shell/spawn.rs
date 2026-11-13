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
use crate::commands::fs::parse_ssh_project_root;
use crate::commands::ssh::{
    channel_exit_rx, close_channel, is_ssh_root, key_for, login_command, map_unreachable,
    open_exec, recv_channel_exit, take_channel_stdio,
};

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
fn signal_process_group(child: &tokio::process::Child, signal: i32) {
    if let Some(pid) = child.id() {
        unsafe {
            libc::killpg(pid as i32, signal);
        }
    }
}

fn shell_exit_from_wait(status: std::io::Result<std::process::ExitStatus>) -> ShellExitResult {
    match status {
        Ok(status) => shell_exit_from_status(status),
        Err(_) => ShellExitResult {
            exit_code: -1,
            signal: None,
        },
    }
}

const KILL_GRACE_PERIOD: Duration = Duration::from_millis(300);

async fn terminate_child(
    child: &mut tokio::process::Child,
    should_kill: bool,
) -> std::io::Result<std::process::ExitStatus> {
    if !should_kill {
        return child.wait().await;
    }
    #[cfg(unix)]
    return terminate_with_group_escalation(child).await;
    #[cfg(not(unix))]
    return terminate_forced(child).await;
}

#[cfg(not(unix))]
async fn terminate_forced(
    child: &mut tokio::process::Child,
) -> std::io::Result<std::process::ExitStatus> {
    let _ = child.start_kill();
    child.wait().await
}

// The child is a process-group leader (setpgid in the spawn builders), so
// killpg reaches its whole tree. Grace the group on SIGTERM, then escalate
// to SIGKILL so grandchildren cannot ignore or trap the stop.
#[cfg(unix)]
async fn terminate_with_group_escalation(
    child: &mut tokio::process::Child,
) -> std::io::Result<std::process::ExitStatus> {
    signal_process_group(child, libc::SIGTERM);
    match tokio::time::timeout(KILL_GRACE_PERIOD, child.wait()).await {
        Ok(status) => status,
        Err(_) => {
            signal_process_group(child, libc::SIGKILL);
            let _ = child.start_kill();
            child.wait().await
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
    project_roots: Option<Vec<crate::commands::fs::WorkspaceRootArg>>,
) -> Result<(), String> {
    if is_ssh_root(&project_root) {
        let _ = (sandboxed, allow_network, project_writable, project_roots);
        return spawn_tracked_remote(app, shell_id, project_root, command).await;
    }

    let mut child = spawn_child(
        &project_root,
        &command,
        sandboxed,
        allow_network,
        project_writable,
        project_roots.as_deref(),
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
          status = child.wait() => shell_exit_from_wait(status),
          kill = kill_rx.recv() => {
            shell_exit_from_wait(terminate_child(&mut child, kill.is_some()).await)
          }
        };

        // Publish the exit before draining output so shell_kill_tracked callers
        // (force-send handoff, stop buttons) return as soon as the process is
        // gone, even when a grandchild keeps the pipe open.
        let _ = exit_tx.send(Some(exit.clone()));

        // Drain remaining stdout/stderr before the exit event so the frontend
        // does not drop the tail when it unregisters listeners on that event.
        join_output_pumps(stdout_task, stderr_task).await;

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

pub(crate) async fn reap_remote_shell(
    channel_id: String,
    exit_watch: tokio::sync::watch::Receiver<Option<i32>>,
    mut kill_rx: tokio::sync::mpsc::Receiver<()>,
) -> i32 {
    tokio::select! {
        code = recv_channel_exit(exit_watch.clone()) => {
            let code = code.unwrap_or(-1);
            let _ = close_channel(channel_id).await;
            code
        }
        kill = kill_rx.recv() => {
            if kill.is_some() {
                let _ = close_channel(channel_id).await;
            }
            recv_channel_exit(exit_watch).await.unwrap_or(-1)
        }
    }
}

async fn spawn_tracked_remote(
    app: AppHandle,
    shell_id: String,
    project_root: String,
    command: String,
) -> Result<(), String> {
    let ssh = parse_ssh_project_root(&project_root)?;
    let info = open_exec(key_for(&ssh), login_command(&ssh.remote_path, &command))
        .await
        .map_err(|err| map_unreachable(&ssh.hostname, err))?;
    let stdio = take_channel_stdio(&info.channel_id)
        .await
        .map_err(|err| map_unreachable(&ssh.hostname, err))?;
    let stdout = stdio.stdout;
    let stderr = stdio
        .stderr
        .ok_or_else(|| "stderr unavailable".to_string())?;
    drop(stdio.stdin);

    let (kill_tx, kill_rx) = tokio::sync::mpsc::channel::<()>(1);
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
    let channel_id = info.channel_id.clone();
    let exit_watch = channel_exit_rx(&channel_id).await?;
    tokio::spawn(async move {
        let exit_code = reap_remote_shell(channel_id, exit_watch, kill_rx).await;
        let exit = ShellExitResult {
            exit_code,
            signal: None,
        };
        let _ = exit_tx.send(Some(exit.clone()));
        join_output_pumps(stdout_task, stderr_task).await;
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

    #[cfg(unix)]
    fn spawn_test_child(command: &str) -> tokio::process::Child {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .unwrap()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminate_child_kills_sigterm_responsive_group() {
        let mut child = spawn_test_child("sleep 30 & wait");
        let pid = child.id().unwrap() as i32;
        let started = Instant::now();

        let status = terminate_child(&mut child, true).await.unwrap();

        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(status.signal(), Some(libc::SIGTERM));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(unsafe { libc::killpg(pid, 0) }, -1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminate_child_escalates_to_sigkill_when_sigterm_ignored() {
        // SIG_IGN survives exec, so the exec'd sleep ignores group SIGTERM;
        // only the post-grace SIGKILL escalation can stop it. The marker file
        // guarantees the trap is installed before the kill is sent.
        let marker = std::env::temp_dir().join(format!(
            "vixl-test-escalate-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&marker);
        let marker_path = marker.to_string_lossy().to_string();
        let mut child = spawn_test_child(&format!(
            "trap '' TERM; : > '{marker_path}'; exec sleep 30"
        ));
        let pid = child.id().unwrap() as i32;

        for _ in 0..100 {
            if marker.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(marker.exists(), "child never installed the TERM trap");
        let _ = std::fs::remove_file(&marker);

        let started = Instant::now();
        let status = terminate_child(&mut child, true).await.unwrap();

        assert!(started.elapsed() >= KILL_GRACE_PERIOD);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(status.signal(), Some(libc::SIGKILL));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(unsafe { libc::killpg(pid, 0) }, -1);
    }
}
