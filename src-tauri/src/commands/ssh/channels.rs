use std::collections::HashMap;
use std::process::Stdio;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::argv::{build_ssh_argv, ArgvRequest, ControlMasterMode, SshInvocation, TtyMode};
use super::errors;
use super::paths::SSH_BIN;
use super::session::{control_check, mark_master_dead, require_live_master, SessionKey};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshChannelInfo {
    pub channel_id: String,
    pub kind: String,
    pub hostname: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub hostname: String,
}

struct LiveChannel {
    kill_tx: tokio::sync::mpsc::Sender<()>,
    stdin: Option<ChildStdin>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    exit_rx: tokio::sync::watch::Receiver<Option<i32>>,
}

pub(crate) struct ChannelStdio {
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
    pub stderr: Option<ChildStderr>,
    pub channel_id: String,
}

lazy_static::lazy_static! {
    static ref CHANNELS: Mutex<HashMap<String, LiveChannel>> = Mutex::new(HashMap::new());
}

async fn fail_if_dead(key: &SessionKey) -> Result<super::session::SessionSnapshot, String> {
    let snapshot = require_live_master(key).await?.snapshot;
    if !control_check(&snapshot) {
        mark_master_dead(key).await;
        return Err(errors::dead_master_channel(&key.hostname));
    }
    Ok(snapshot)
}

pub async fn open_exec(key: SessionKey, command: String) -> Result<SshChannelInfo, String> {
    let snapshot = fail_if_dead(&key).await?;
    spawn_channel(
        snapshot,
        SshInvocation::Exec { command },
        TtyMode::No,
        "exec",
    )
    .await
}

pub async fn open_sftp(key: SessionKey) -> Result<SshChannelInfo, String> {
    let snapshot = fail_if_dead(&key).await?;
    spawn_channel(snapshot, SshInvocation::Sftp, TtyMode::No, "sftp").await
}

pub async fn open_tty(key: SessionKey, command: Option<String>) -> Result<SshChannelInfo, String> {
    let snapshot = fail_if_dead(&key).await?;
    spawn_channel(
        snapshot,
        SshInvocation::Tty { command },
        TtyMode::Force,
        "tty",
    )
    .await
}

pub async fn tty_argv_on_master(
    key: SessionKey,
    command: Option<String>,
) -> Result<super::argv::SshArgv, String> {
    let snapshot = fail_if_dead(&key).await?;
    Ok(build_ssh_argv(ArgvRequest {
        destination: &snapshot.destination,
        control_path: Some(&snapshot.control_path.to_string_lossy()),
        control_master: ControlMasterMode::No,
        tty: TtyMode::Force,
        vixl_known_hosts: &snapshot.paths.known_hosts().to_string_lossy(),
        user_known_hosts: &snapshot.paths.user_known_hosts().to_string_lossy(),
        password_only: false,
        port: Some(snapshot.key.port),
        identity_file: None,
        invocation: SshInvocation::Tty { command },
        config_file: None,
    }))
}

async fn spawn_channel(
    snapshot: super::session::SessionSnapshot,
    invocation: SshInvocation,
    tty: TtyMode,
    kind: &str,
) -> Result<SshChannelInfo, String> {
    let argv = build_ssh_argv(ArgvRequest {
        destination: &snapshot.destination,
        control_path: Some(&snapshot.control_path.to_string_lossy()),
        control_master: ControlMasterMode::No,
        tty,
        vixl_known_hosts: &snapshot.paths.known_hosts().to_string_lossy(),
        user_known_hosts: &snapshot.paths.user_known_hosts().to_string_lossy(),
        password_only: false,
        port: Some(snapshot.key.port),
        identity_file: None,
        invocation,
        config_file: None,
    });
    let mut command = Command::new(SSH_BIN);
    command
        .args(&argv.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|err| errors::ssh_missing(&snapshot.key.hostname, &err.to_string()))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let channel_id = Uuid::new_v4().to_string();
    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::channel::<()>(1);
    let (exit_tx, exit_rx) = tokio::sync::watch::channel::<Option<i32>>(None);
    CHANNELS.lock().await.insert(
        channel_id.clone(),
        LiveChannel {
            kill_tx: kill_tx.clone(),
            stdin,
            stdout,
            stderr,
            exit_rx: exit_rx.clone(),
        },
    );
    tokio::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            kill = kill_rx.recv() => {
                if kill.is_some() {
                    let _ = child.start_kill();
                }
                child.wait().await
            }
        };
        let code = status.ok().and_then(|status| status.code()).unwrap_or(-1);
        let _ = exit_tx.send(Some(code));
    });
    Ok(SshChannelInfo {
        channel_id,
        kind: kind.to_string(),
        hostname: snapshot.key.hostname,
    })
}

pub(crate) async fn take_channel_stdio(channel_id: &str) -> Result<ChannelStdio, String> {
    let mut channels = CHANNELS.lock().await;
    let channel = channels
        .get_mut(channel_id)
        .ok_or_else(|| "SSH channel not found".to_string())?;
    let stdin = channel
        .stdin
        .take()
        .ok_or_else(|| "SSH channel stdin is closed".to_string())?;
    let stdout = channel
        .stdout
        .take()
        .ok_or_else(|| "SSH channel stdout is closed".to_string())?;
    let stderr = channel.stderr.take();
    Ok(ChannelStdio {
        stdin,
        stdout,
        stderr,
        channel_id: channel_id.to_string(),
    })
}

pub async fn write_channel_stdin(channel_id: &str, data: &[u8]) -> Result<(), String> {
    let mut stdin = {
        let mut channels = CHANNELS.lock().await;
        let channel = channels
            .get_mut(channel_id)
            .ok_or_else(|| "SSH channel not found".to_string())?;
        channel
            .stdin
            .take()
            .ok_or_else(|| "SSH channel stdin is closed".to_string())?
    };
    let result = async {
        stdin.write_all(data).await.map_err(|err| err.to_string())?;
        stdin.flush().await.map_err(|err| err.to_string())
    }
    .await;
    {
        let mut channels = CHANNELS.lock().await;
        if let Some(channel) = channels.get_mut(channel_id) {
            channel.stdin = Some(stdin);
        }
    }
    result
}

pub async fn read_channel_stdout(channel_id: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    read_channel_pipe(channel_id, max_bytes, true).await
}

pub async fn read_channel_stderr(channel_id: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    read_channel_pipe(channel_id, max_bytes, false).await
}

async fn read_channel_pipe(
    channel_id: &str,
    max_bytes: usize,
    stdout: bool,
) -> Result<Vec<u8>, String> {
    if stdout {
        let mut reader = {
            let mut channels = CHANNELS.lock().await;
            let channel = channels
                .get_mut(channel_id)
                .ok_or_else(|| "SSH channel not found".to_string())?;
            channel
                .stdout
                .take()
                .ok_or_else(|| "SSH channel stdout is closed".to_string())?
        };
        let mut buf = vec![0u8; max_bytes.max(1)];
        let result = reader.read(&mut buf).await.map_err(|err| err.to_string());
        {
            let mut channels = CHANNELS.lock().await;
            if let Some(channel) = channels.get_mut(channel_id) {
                channel.stdout = Some(reader);
            }
        }
        let n = result?;
        buf.truncate(n);
        Ok(buf)
    } else {
        let mut reader = {
            let mut channels = CHANNELS.lock().await;
            let channel = channels
                .get_mut(channel_id)
                .ok_or_else(|| "SSH channel not found".to_string())?;
            channel
                .stderr
                .take()
                .ok_or_else(|| "SSH channel stderr is closed".to_string())?
        };
        let mut buf = vec![0u8; max_bytes.max(1)];
        let result = reader.read(&mut buf).await.map_err(|err| err.to_string());
        {
            let mut channels = CHANNELS.lock().await;
            if let Some(channel) = channels.get_mut(channel_id) {
                channel.stderr = Some(reader);
            }
        }
        let n = result?;
        buf.truncate(n);
        Ok(buf)
    }
}

async fn collect_stdio(
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
) -> (String, String) {
    let stdout_task = async {
        let mut buf = Vec::new();
        if let Some(mut reader) = stdout {
            let _ = reader.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).into_owned()
    };
    let stderr_task = async {
        let mut buf = Vec::new();
        if let Some(mut reader) = stderr {
            let _ = reader.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).into_owned()
    };
    tokio::join!(stdout_task, stderr_task)
}

pub async fn exec_wait(key: SessionKey, command: String) -> Result<SshExecResult, String> {
    let snapshot = fail_if_dead(&key).await?;
    let argv = build_ssh_argv(ArgvRequest {
        destination: &snapshot.destination,
        control_path: Some(&snapshot.control_path.to_string_lossy()),
        control_master: ControlMasterMode::No,
        tty: TtyMode::No,
        vixl_known_hosts: &snapshot.paths.known_hosts().to_string_lossy(),
        user_known_hosts: &snapshot.paths.user_known_hosts().to_string_lossy(),
        password_only: false,
        port: Some(snapshot.key.port),
        identity_file: None,
        invocation: SshInvocation::Exec { command },
        config_file: None,
    });
    let mut child = Command::new(SSH_BIN)
        .args(&argv.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| errors::ssh_missing(&snapshot.key.hostname, &err.to_string()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (stdout, stderr) = collect_stdio(stdout, stderr).await;
    let status = child.wait().await.map_err(|err| err.to_string())?;
    if !control_check(&snapshot) {
        mark_master_dead(&key).await;
        return Err(errors::dead_master_channel(&key.hostname));
    }
    Ok(SshExecResult {
        stdout,
        stderr,
        exit_code: status.code().unwrap_or(-1),
        hostname: snapshot.key.hostname,
    })
}

pub async fn open_local_forward(
    key: SessionKey,
    bind_address: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), String> {
    if bind_address != "127.0.0.1" {
        return Err("0.0.0.0 is refused.".to_string());
    }
    if local_port == 0 || remote_port == 0 {
        return Err(errors::port_not_valid());
    }
    let remote_host = remote_host.trim();
    if remote_host.is_empty() {
        return Err("Enter a remote host.".to_string());
    }
    let snapshot = fail_if_dead(&key).await?;
    let spec = format!("{bind_address}:{local_port}:{remote_host}:{remote_port}");
    let argv = build_ssh_argv(ArgvRequest {
        destination: &snapshot.destination,
        control_path: Some(&snapshot.control_path.to_string_lossy()),
        control_master: ControlMasterMode::No,
        tty: TtyMode::No,
        vixl_known_hosts: &snapshot.paths.known_hosts().to_string_lossy(),
        user_known_hosts: &snapshot.paths.user_known_hosts().to_string_lossy(),
        password_only: false,
        port: Some(snapshot.key.port),
        identity_file: None,
        invocation: SshInvocation::ControlForward { spec },
        config_file: None,
    });
    let output = Command::new(SSH_BIN)
        .args(&argv.args)
        .output()
        .await
        .map_err(|err| errors::ssh_missing(&snapshot.key.hostname, &err.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }
    if !control_check(&snapshot) {
        mark_master_dead(&key).await;
        return Err(errors::dead_master_channel(&snapshot.key.hostname));
    }
    Ok(())
}

pub async fn close_channel(channel_id: String) -> Result<(), String> {
    let kill_tx = {
        let mut channels = CHANNELS.lock().await;
        channels.remove(&channel_id).map(|channel| channel.kill_tx)
    };
    if let Some(kill_tx) = kill_tx {
        let _ = kill_tx.send(()).await;
        Ok(())
    } else {
        Err("SSH channel not found".to_string())
    }
}

pub async fn channel_exit_rx(
    channel_id: &str,
) -> Result<tokio::sync::watch::Receiver<Option<i32>>, String> {
    let channels = CHANNELS.lock().await;
    channels
        .get(channel_id)
        .map(|channel| channel.exit_rx.clone())
        .ok_or_else(|| "SSH channel not found".to_string())
}

pub async fn wait_channel_exit(channel_id: &str) -> Result<i32, String> {
    recv_channel_exit(channel_exit_rx(channel_id).await?).await
}

pub async fn recv_channel_exit(
    mut rx: tokio::sync::watch::Receiver<Option<i32>>,
) -> Result<i32, String> {
    loop {
        if let Some(code) = *rx.borrow() {
            return Ok(code);
        }
        if rx.changed().await.is_err() {
            return Ok(-1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ssh::paths::SshPaths;
    use crate::commands::ssh::session::{
        clear_sessions_for_tests, insert_test_session, session_key, SshSessionStatus,
        SESSION_TEST_LOCK,
    };
    use tempfile::tempdir;

    #[tokio::test]
    async fn dead_master_makes_next_channel_fail_and_names_host() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "aidanhibbard".to_string(),
                hostname: "eva.local".to_string(),
                port: 22,
                destination: "eva".to_string(),
                state: "disconnected".to_string(),
                line: "eva.local is not connected".to_string(),
                last_error: None,
                master_alive: false,
            },
            paths,
            dir.path().join("cm-missing"),
        )
        .await;
        let err = open_exec(
            session_key("aidanhibbard", "eva.local", 22),
            "true".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("eva.local"));
        assert!(err.contains("not connected") || err.contains("dead"));
        let exec_err = exec_wait(
            session_key("aidanhibbard", "eva.local", 22),
            "true".to_string(),
        )
        .await
        .unwrap_err();
        assert!(exec_err.contains("eva.local"));
        assert!(!exec_err.is_empty());
        let tty_err = tty_argv_on_master(
            session_key("aidanhibbard", "eva.local", 22),
            Some("true".to_string()),
        )
        .await
        .unwrap_err();
        assert!(tty_err.contains("eva.local"));
        clear_sessions_for_tests().await;
    }

    #[tokio::test]
    async fn concurrent_pipe_read_returns_both_streams() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "echo stdout-marker; echo stderr-marker >&2"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sh");
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (stdout, stderr) = collect_stdio(stdout, stderr).await;
        let status = child.wait().await.expect("wait");
        assert!(status.success());
        assert!(stdout.contains("stdout-marker"), "stdout was {stdout:?}");
        assert!(stderr.contains("stderr-marker"), "stderr was {stderr:?}");
    }

    #[tokio::test]
    async fn local_forward_refuses_wildcard_bind() {
        let err = open_local_forward(
            session_key("u", "h.example", 22),
            "0.0.0.0".to_string(),
            8080,
            "127.0.0.1".to_string(),
            80,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "0.0.0.0 is refused.");
    }
}
