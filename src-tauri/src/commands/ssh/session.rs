use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use super::argv::{build_ssh_argv, ArgvRequest, ControlMasterMode, SshInvocation, TtyMode};
use super::askpass::{require_helper_mode_0700, write_askpass_helper};
use super::auth::AuthAttempt;
use super::errors::{self, SshErrorCopy};
use super::events::{emit_banner, emit_error, emit_status, SshBannerEvent, SshStatusEvent};
use super::known_hosts::snapshot_known_hosts;
use super::orphan::{acquire_control_lock, reap_orphans_for_control_path, ControlLock};
use super::paths::{
    ensure_dir_mode_0700, require_control_path_len, require_socket_path_len, session_control_id,
    set_mode_0600, SshPaths, SSH_BIN,
};
use super::preview::{preview_destination, SshPreview};
use super::prompt::{cancel_all_prompts, run_askpass_listener, ConnectCtx};
use super::validate::{
    destination_with_user, resolve_connect_user, validate_destination, validate_port,
};
use super::vault::{read_passphrase, read_password};

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct SessionKey {
    pub user: String,
    pub hostname: String,
    pub port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionStatus {
    pub user: String,
    pub hostname: String,
    pub port: u16,
    pub destination: String,
    pub state: String,
    pub line: String,
    pub last_error: Option<SshErrorCopy>,
    pub master_alive: bool,
}

struct SessionRecord {
    key: SessionKey,
    paths: SshPaths,
    destination: String,
    control_path: PathBuf,
    state: String,
    line: String,
    last_error: Option<SshErrorCopy>,
    kill_tx: Option<tokio::sync::mpsc::Sender<()>>,
    #[allow(dead_code)]
    lock: Option<ControlLock>,
    master_alive: bool,
    user_cancelled: Arc<AtomicBool>,
    master_generation: u64,
}

static NEXT_MASTER_GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_master_generation() -> u64 {
    NEXT_MASTER_GENERATION.fetch_add(1, Ordering::SeqCst)
}

lazy_static::lazy_static! {
    static ref SESSIONS: Mutex<HashMap<SessionKey, SessionRecord>> = Mutex::new(HashMap::new());
    static ref CONTROL_SOCKET_GATE: Mutex<()> = Mutex::new(());
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectRequest {
    pub destination: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub password_only: Option<bool>,
    pub config_file: Option<String>,
    pub vixl_ssh_dir: Option<String>,
    pub user_ssh_dir: Option<String>,
}

fn status_from_record(record: &SessionRecord) -> SshSessionStatus {
    SshSessionStatus {
        user: record.key.user.clone(),
        hostname: record.key.hostname.clone(),
        port: record.key.port,
        destination: record.destination.clone(),
        state: record.state.clone(),
        line: record.line.clone(),
        last_error: record.last_error.clone(),
        master_alive: record.master_alive,
    }
}

pub async fn session_status(user: &str, hostname: &str, port: u16) -> SshSessionStatus {
    let key = SessionKey {
        user: user.to_string(),
        hostname: hostname.to_string(),
        port,
    };
    let sessions = SESSIONS.lock().await;
    if let Some(record) = sessions.get(&key) {
        return status_from_record(record);
    }
    SshSessionStatus {
        user: user.to_string(),
        hostname: hostname.to_string(),
        port,
        destination: String::new(),
        state: "disconnected".to_string(),
        line: errors::not_connected(hostname),
        last_error: None,
        master_alive: false,
    }
}

pub async fn list_sessions() -> Vec<SshSessionStatus> {
    SESSIONS
        .lock()
        .await
        .values()
        .map(status_from_record)
        .collect()
}

pub fn session_key(user: &str, hostname: &str, port: u16) -> SessionKey {
    SessionKey {
        user: user.to_string(),
        hostname: hostname.to_string(),
        port,
    }
}

pub struct LiveMaster {
    pub snapshot: SessionSnapshot,
    pub generation: u64,
}

pub async fn require_live_master(key: &SessionKey) -> Result<LiveMaster, String> {
    let sessions = SESSIONS.lock().await;
    let Some(record) = sessions.get(key) else {
        return Err(errors::dead_master_channel(&key.hostname));
    };
    if !record.master_alive || record.state != "connected" {
        return Err(errors::dead_master_channel(&key.hostname));
    }
    Ok(LiveMaster {
        generation: record.master_generation,
        snapshot: SessionSnapshot {
            key: record.key.clone(),
            destination: record.destination.clone(),
            control_path: record.control_path.clone(),
            paths: record.paths.clone(),
        },
    })
}

fn apply_master_exit(
    record: &mut SessionRecord,
    generation: u64,
    hostname: &str,
    stderr_text: &str,
    exit_success: bool,
) -> Option<SshErrorCopy> {
    if record.master_generation != generation {
        return None;
    }
    let user_disconnected =
        record.state == "disconnected" || record.user_cancelled.load(Ordering::SeqCst);
    match errors::master_exit_report(hostname, stderr_text, exit_success, user_disconnected) {
        errors::MasterExitReport::UserDisconnect => {
            record.master_alive = false;
            record.state = "disconnected".to_string();
            record.line = format!("Disconnected from {hostname}.");
            record.last_error = None;
            None
        }
        errors::MasterExitReport::Failure(copy) => {
            record.master_alive = false;
            record.line = copy.title.clone();
            record.last_error = Some(copy.clone());
            if record.state != "disconnected" {
                record.state = "disconnected".to_string();
            }
            Some(copy)
        }
    }
}

#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub key: SessionKey,
    pub destination: String,
    pub control_path: PathBuf,
    pub paths: SshPaths,
}

pub fn control_check(snapshot: &SessionSnapshot) -> bool {
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
        invocation: SshInvocation::ControlCheck,
        config_file: None,
    });
    std::process::Command::new(SSH_BIN)
        .args(&argv.args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub async fn mark_master_dead(key: &SessionKey) {
    if let Some(record) = SESSIONS.lock().await.get_mut(key) {
        record.master_alive = false;
        record.state = "disconnected".to_string();
        record.line = errors::not_connected(&key.hostname);
    }
    crate::commands::fs::close_pooled_sftp(key).await;
}

fn connect_poll_succeeded(state: &str, control_ok: bool, user_cancelled: bool) -> bool {
    !user_cancelled && state == "connecting" && control_ok
}

async fn session_record_state(key: &SessionKey) -> Option<String> {
    SESSIONS
        .lock()
        .await
        .get(key)
        .map(|record| record.state.clone())
}

fn emit_line(app: Option<&AppHandle>, preview: &SshPreview, line: &str) {
    emit_status(
        app,
        &SshStatusEvent {
            user: preview.user.clone(),
            hostname: preview.hostname.clone(),
            port: preview.port,
            line: line.to_string(),
        },
    );
}

pub async fn connect(
    app: Option<AppHandle>,
    request: SshConnectRequest,
) -> Result<SshSessionStatus, String> {
    let destination = validate_destination(&request.destination)?;
    let port = validate_port(request.port)?;
    let user = resolve_connect_user(request.user.as_deref(), &destination)?;
    let ssh_destination = destination_with_user(&destination, &user);
    let paths = match (request.vixl_ssh_dir.as_ref(), request.user_ssh_dir.as_ref()) {
        (Some(vixl), Some(user)) => SshPaths::from_roots(PathBuf::from(vixl), PathBuf::from(user)),
        _ => SshPaths::production()?,
    };
    ensure_dir_mode_0700(&paths.vixl_ssh_dir)?;
    ensure_dir_mode_0700(&paths.control_dir())?;

    let mut preview = preview_destination(
        &paths,
        &ssh_destination,
        port,
        request.identity_file.as_deref(),
        request.config_file.as_deref(),
    )?;
    preview.user = user.clone();
    let key = session_key(&user, &preview.hostname, preview.port);

    {
        let sessions = SESSIONS.lock().await;
        if let Some(record) = sessions.get(&key) {
            if record.master_alive && record.state == "connected" {
                let mut status = status_from_record(record);
                status.line = errors::already_connected(&preview.hostname);
                return Ok(status);
            }
        }
    }

    emit_line(
        app.as_ref(),
        &preview,
        &format!("Looking up {}.", preview.hostname),
    );

    let control_id = session_control_id(&key.user, &key.hostname, key.port);
    let control_path = paths.control_path(&control_id);
    let askpass_sock = paths.askpass_socket(&control_id);
    require_control_path_len(&control_path, &preview.hostname)?;
    require_socket_path_len(&askpass_sock, &preview.hostname)?;

    let helper = paths.askpass_helper();
    write_askpass_helper(&helper)?;
    require_helper_mode_0700(&helper, &preview.hostname)?;

    let lock = acquire_control_lock(&paths.lock_path(&control_id))?;
    let _ = reap_orphans_for_control_path(&control_path.to_string_lossy());
    let _control_gate = CONTROL_SOCKET_GATE.lock().await;
    let _ = std::fs::remove_file(&control_path);

    emit_line(
        app.as_ref(),
        &preview,
        &format!("Connecting to {} port {}.", preview.hostname, preview.port),
    );

    let saved_password = match &app {
        Some(app) => read_password(app, &user, &preview.hostname, preview.port)
            .ok()
            .flatten(),
        None => None,
    };
    let saved_passphrase = match (&app, preview.identity_files.first()) {
        (Some(app), Some(identity)) => read_passphrase(app, identity).ok().flatten(),
        _ => None,
    };
    let identity_basename = preview.identity_files.first().and_then(|path| {
        std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
    });

    let user_cancelled = Arc::new(AtomicBool::new(false));
    let ctx = Arc::new(ConnectCtx {
        auth: Mutex::new(AuthAttempt::new(saved_password, saved_passphrase)),
        paths: paths.clone(),
        known_hosts_before: snapshot_known_hosts(&paths.known_hosts()),
        also_add: AtomicBool::new(false),
        user_cancelled: user_cancelled.clone(),
        stderr: Mutex::new(String::new()),
        user: user.clone(),
        hostname: preview.hostname.clone(),
        port: preview.port,
        identity_basename,
    });

    let (listener_stop_tx, listener_stop_rx) = tokio::sync::watch::channel(false);
    let listener_app = app.clone();
    let listener_ctx = ctx.clone();
    let listener_sock = askpass_sock.clone();
    let listener = tokio::spawn(async move {
        run_askpass_listener(listener_sock, listener_app, listener_ctx, listener_stop_rx).await;
    });

    let argv = build_ssh_argv(ArgvRequest {
        destination: &ssh_destination,
        control_path: Some(&control_path.to_string_lossy()),
        control_master: ControlMasterMode::Yes,
        tty: TtyMode::No,
        vixl_known_hosts: &paths.known_hosts().to_string_lossy(),
        user_known_hosts: &paths.user_known_hosts().to_string_lossy(),
        password_only: request.password_only.unwrap_or(false),
        port: Some(preview.port),
        identity_file: request.identity_file.as_deref(),
        invocation: SshInvocation::Master,
        config_file: request.config_file.as_deref(),
    });

    let mut command = Command::new(SSH_BIN);
    command
        .args(&argv.args)
        .env("SSH_ASKPASS", &helper)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("VIXL_SSH_ASKPASS_SOCK", &askpass_sock)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        command.process_group(0);
        #[cfg(target_os = "linux")]
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM, 0, 0, 0);
                Ok(())
            });
        }
    }

    let mut child = command.spawn().map_err(|err| {
        let _ = listener_stop_tx.send(true);
        errors::ssh_missing(&preview.hostname, &err.to_string())
    })?;

    let stderr = child.stderr.take();
    let stdout = child.stdout.take();
    let stderr_ctx = ctx.clone();
    let stderr_app = app.clone();
    let stderr_host = preview.hostname.clone();
    let stderr_port = preview.port;
    if let Some(mut stderr) = stderr {
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            let mut banner = String::new();
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(count) => {
                        let chunk = String::from_utf8_lossy(&buf[..count]);
                        stderr_ctx.stderr.lock().await.push_str(&chunk);
                        if !chunk.to_ascii_lowercase().contains("warning:")
                            && !chunk.to_ascii_lowercase().contains("permanently added")
                            && !chunk.contains("ssh:")
                        {
                            banner.push_str(&chunk);
                        }
                    }
                    Err(_) => break,
                }
            }
            let trimmed = banner.trim();
            if !trimmed.is_empty() && !errors::looks_like_host_key_changed(trimmed) {
                emit_banner(
                    stderr_app.as_ref(),
                    &SshBannerEvent {
                        hostname: stderr_host,
                        port: stderr_port,
                        text: trimmed.to_string(),
                    },
                );
            }
        });
    }
    if let Some(mut stdout) = stdout {
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
    }

    let (kill_tx, mut kill_rx) = tokio::sync::mpsc::channel::<()>(1);
    let master_generation = next_master_generation();
    let wait_ctx = ctx.clone();
    let wait_key = key.clone();
    let wait_app = app.clone();
    let wait_host = preview.hostname.clone();
    let wait_port = preview.port;
    let wait_generation = master_generation;
    tokio::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            kill = kill_rx.recv() => {
                if kill.is_some() {
                    #[cfg(unix)]
                    if let Some(pid) = child.id() {
                        unsafe {
                            libc::killpg(pid as i32, libc::SIGTERM);
                        }
                    }
                    let _ = child.start_kill();
                }
                child.wait().await
            }
        };
        let stderr_text = wait_ctx.stderr.lock().await.clone();
        let exit_success = matches!(status, Ok(code) if code.success());
        let copy = {
            let mut sessions = SESSIONS.lock().await;
            let Some(record) = sessions.get_mut(&wait_key) else {
                return;
            };
            apply_master_exit(
                record,
                wait_generation,
                &wait_host,
                &stderr_text,
                exit_success,
            )
        };
        if let Some(copy) = copy {
            emit_error(
                wait_app.as_ref(),
                &wait_key.user,
                &wait_host,
                wait_port,
                &copy,
            );
        }
    });

    {
        let mut sessions = SESSIONS.lock().await;
        sessions.insert(
            key.clone(),
            SessionRecord {
                key: key.clone(),
                paths: paths.clone(),
                destination: ssh_destination.clone(),
                control_path: control_path.clone(),
                state: "connecting".to_string(),
                line: format!("Connecting to {} port {}.", preview.hostname, preview.port),
                last_error: None,
                kill_tx: Some(kill_tx.clone()),
                lock: Some(lock),
                master_alive: false,
                user_cancelled: user_cancelled.clone(),
                master_generation,
            },
        );
    }
    drop(_control_gate);

    let snapshot = SessionSnapshot {
        key: key.clone(),
        destination: ssh_destination.clone(),
        control_path: control_path.clone(),
        paths: paths.clone(),
    };
    let connected = loop {
        if user_cancelled.load(Ordering::SeqCst) {
            break false;
        }
        let state = session_record_state(&key).await;
        if state.as_deref() == Some("disconnected") {
            break false;
        }
        if control_path.exists() && control_check(&snapshot) {
            let state = session_record_state(&key).await;
            break connect_poll_succeeded(
                state.as_deref().unwrap_or("disconnected"),
                true,
                user_cancelled.load(Ordering::SeqCst),
            );
        }
        let alive = SESSIONS
            .lock()
            .await
            .get(&key)
            .map(|record| record.kill_tx.is_some() && record.state == "connecting")
            .unwrap_or(false);
        if !alive {
            let stderr_text = ctx.stderr.lock().await.clone();
            if !stderr_text.is_empty() && control_path.exists() {
                let state = session_record_state(&key).await;
                break connect_poll_succeeded(
                    state.as_deref().unwrap_or("disconnected"),
                    control_check(&snapshot),
                    user_cancelled.load(Ordering::SeqCst),
                );
            }
            if SESSIONS
                .lock()
                .await
                .get(&key)
                .map(|record| record.state != "connecting")
                .unwrap_or(true)
            {
                break false;
            }
        }
        if SESSIONS
            .lock()
            .await
            .get(&key)
            .map(|record| !record.master_alive && record.state != "connecting")
            .unwrap_or(false)
        {
            break false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        if control_path.exists() {
            let _ = set_mode_0600(&control_path);
            if control_check(&snapshot) {
                let state = session_record_state(&key).await;
                break connect_poll_succeeded(
                    state.as_deref().unwrap_or("disconnected"),
                    true,
                    user_cancelled.load(Ordering::SeqCst),
                );
            }
        }
        let sessions = SESSIONS.lock().await;
        if let Some(record) = sessions.get(&key) {
            if record.state == "disconnected" {
                break false;
            }
        }
    };

    let _ = listener_stop_tx.send(true);
    let _ = listener.await;
    cancel_all_prompts().await;

    if connected {
        let line = format!("Connected as {user}@{host}.", host = preview.hostname);
        emit_line(app.as_ref(), &preview, &line);
        let mut sessions = SESSIONS.lock().await;
        if let Some(record) = sessions.get_mut(&key) {
            if record.state != "connecting" {
                return Ok(status_from_record(record));
            }
            record.state = "connected".to_string();
            record.line = line;
            record.master_alive = true;
            record.last_error = None;
            let _ = set_mode_0600(&control_path);
            return Ok(status_from_record(record));
        }
    }

    if session_record_state(&key).await.as_deref() == Some("disconnected")
        && !user_cancelled.load(Ordering::SeqCst)
    {
        return Ok(session_status(&user, &preview.hostname, preview.port).await);
    }

    let stderr_text = ctx.stderr.lock().await.clone();
    if errors::looks_like_host_key_changed(&stderr_text) {
        ctx.auth.lock().await.note_host_key_changed();
    }
    let copy = errors::connect_failure_copy(
        &preview.hostname,
        &stderr_text,
        user_cancelled.load(Ordering::SeqCst),
    );
    let _ = kill_tx.send(()).await;
    let owned = {
        let mut sessions = SESSIONS.lock().await;
        sessions
            .get_mut(&key)
            .is_some_and(|record| record_connect_failure(record, master_generation, copy.clone()))
    };
    if owned {
        emit_error(app.as_ref(), &user, &preview.hostname, preview.port, &copy);
    }
    Err(copy.into_message())
}

fn record_connect_failure(record: &mut SessionRecord, generation: u64, copy: SshErrorCopy) -> bool {
    if record.master_generation != generation {
        return false;
    }
    record.state = "error".to_string();
    record.line = copy.title.clone();
    record.last_error = Some(copy);
    record.master_alive = false;
    true
}

async fn disconnect_still_owns(key: &SessionKey, generation: u64) -> bool {
    SESSIONS
        .lock()
        .await
        .get(key)
        .is_some_and(|record| record.master_generation == generation)
}

async fn remove_control_socket_if_owned(key: &SessionKey, generation: u64, path: &PathBuf) {
    if disconnect_still_owns(key, generation).await {
        let _ = std::fs::remove_file(path);
    }
}

pub async fn disconnect(user: &str, hostname: &str, port: u16) -> Result<SshSessionStatus, String> {
    let key = session_key(user, hostname, port);
    let open = {
        let mut sessions = SESSIONS.lock().await;
        let Some(record) = sessions.get_mut(&key) else {
            return Ok(SshSessionStatus {
                user: user.to_string(),
                hostname: hostname.to_string(),
                port,
                destination: String::new(),
                state: "disconnected".to_string(),
                line: format!("Disconnected from {hostname}."),
                last_error: None,
                master_alive: false,
            });
        };
        record.master_alive = false;
        record.state = "disconnected".to_string();
        record.line = format!("Disconnected from {hostname}.");
        record.last_error = None;
        let generation = record.master_generation;
        let kill_tx = record.kill_tx.clone();
        let destination = record.destination.clone();
        let control_path = record.control_path.clone();
        let paths = record.paths.clone();
        drop(record.lock.take());
        Some((generation, kill_tx, destination, control_path, paths))
    };
    let Some((generation, kill_tx, destination, control_path, paths)) = open else {
        return Ok(session_status(user, hostname, port).await);
    };
    crate::commands::fs::close_pooled_sftp(&key).await;
    let _gate = CONTROL_SOCKET_GATE.lock().await;
    if !disconnect_still_owns(&key, generation).await {
        if let Some(kill_tx) = kill_tx {
            let _ = kill_tx.send(()).await;
        }
        return Ok(session_status(user, hostname, port).await);
    }
    let snapshot = SessionSnapshot {
        key: key.clone(),
        destination,
        control_path: control_path.clone(),
        paths,
    };
    let argv = build_ssh_argv(ArgvRequest {
        destination: &snapshot.destination,
        control_path: Some(&snapshot.control_path.to_string_lossy()),
        control_master: ControlMasterMode::No,
        tty: TtyMode::No,
        vixl_known_hosts: &snapshot.paths.known_hosts().to_string_lossy(),
        user_known_hosts: &snapshot.paths.user_known_hosts().to_string_lossy(),
        password_only: false,
        port: Some(port),
        identity_file: None,
        invocation: SshInvocation::ControlExit,
        config_file: None,
    });
    let _ = std::process::Command::new(SSH_BIN)
        .args(&argv.args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    if disconnect_still_owns(&key, generation).await {
        if let Some(kill_tx) = kill_tx {
            let _ = kill_tx.send(()).await;
        }
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    remove_control_socket_if_owned(&key, generation, &control_path).await;
    drop(_gate);
    Ok(session_status(user, hostname, port).await)
}

pub async fn cancel_connect(user: &str, hostname: &str, port: u16) -> Result<(), String> {
    let key = session_key(user, hostname, port);
    {
        let sessions = SESSIONS.lock().await;
        if let Some(record) = sessions.get(&key) {
            record.user_cancelled.store(true, Ordering::SeqCst);
        }
    }
    cancel_all_prompts().await;
    let _ = disconnect(user, hostname, port).await;
    Ok(())
}

#[cfg(test)]
lazy_static::lazy_static! {
    pub static ref SESSION_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::new(());
}

#[cfg(test)]
pub async fn insert_test_session(status: SshSessionStatus, paths: SshPaths, control_path: PathBuf) {
    let key = session_key(&status.user, &status.hostname, status.port);
    SESSIONS.lock().await.insert(
        key.clone(),
        SessionRecord {
            key,
            paths,
            destination: status.destination,
            control_path,
            state: status.state,
            line: status.line,
            last_error: status.last_error,
            kill_tx: None,
            lock: None,
            master_alive: status.master_alive,
            user_cancelled: Arc::new(AtomicBool::new(false)),
            master_generation: next_master_generation(),
        },
    );
}

#[cfg(test)]
pub async fn clear_sessions_for_tests() {
    SESSIONS.lock().await.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn two_connects_share_one_master_record() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        let status = SshSessionStatus {
            user: "aidanhibbard".to_string(),
            hostname: "eva.local".to_string(),
            port: 22,
            destination: "eva".to_string(),
            state: "connected".to_string(),
            line: "Connected as aidanhibbard@eva.local.".to_string(),
            last_error: None,
            master_alive: true,
        };
        insert_test_session(status.clone(), paths.clone(), dir.path().join("cm")).await;
        insert_test_session(status.clone(), paths, dir.path().join("cm")).await;
        let sessions = list_sessions().await;
        let matching: Vec<_> = sessions
            .into_iter()
            .filter(|item| {
                item.hostname == "eva.local" && item.user == "aidanhibbard" && item.port == 22
            })
            .collect();
        assert_eq!(matching.len(), 1);
        clear_sessions_for_tests().await;
    }

    #[tokio::test]
    async fn already_connected_does_not_start_second_master() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "u".to_string(),
                hostname: "h.example".to_string(),
                port: 22,
                destination: "h".to_string(),
                state: "connected".to_string(),
                line: "Connected as u@h.example.".to_string(),
                last_error: None,
                master_alive: true,
            },
            paths,
            dir.path().join("cm"),
        )
        .await;
        let first = session_status("u", "h.example", 22).await;
        let second = session_status("u", "h.example", 22).await;
        assert_eq!(first.user, second.user);
        assert!(first.master_alive);
        assert!(second.master_alive);
        clear_sessions_for_tests().await;
    }

    #[test]
    fn user_disconnect_blocks_connect_promotion() {
        assert!(!connect_poll_succeeded("disconnected", true, false));
        assert!(!connect_poll_succeeded("connecting", true, true));
        assert!(!connect_poll_succeeded("disconnected", true, true));
        assert!(connect_poll_succeeded("connecting", true, false));
        assert!(!connect_poll_succeeded("connecting", false, false));
    }

    #[test]
    fn connect_request_password_only_is_a_field() {
        let request: SshConnectRequest =
            serde_json::from_str(r#"{"destination":"eva","passwordOnly":true,"port":22}"#)
                .expect("request");
        assert_eq!(request.destination, "eva");
        assert_eq!(request.password_only, Some(true));
        assert_eq!(request.port, Some(22));
        assert!(request.config_file.is_none());
    }

    #[tokio::test]
    async fn stale_master_exit_does_not_clobber_a_newer_connect() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let hostname = "vixl-stale-master.example";
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "aidanhibbard".to_string(),
                hostname: hostname.to_string(),
                port: 22,
                destination: hostname.to_string(),
                state: "connecting".to_string(),
                line: format!("Connecting to {hostname} port 22."),
                last_error: None,
                master_alive: false,
            },
            paths,
            dir.path().join("cm-missing"),
        )
        .await;
        let key = session_key("aidanhibbard", hostname, 22);
        let stale = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            let stale = record.master_generation;
            record.master_generation = next_master_generation();
            record.state = "connecting".to_string();
            stale
        };
        let copy = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            apply_master_exit(record, stale, hostname, "Connection closed", false)
        };
        assert!(copy.is_none());
        let (state, last_error) = {
            let sessions = SESSIONS.lock().await;
            let record = sessions.get(&key).expect("session");
            (record.state.clone(), record.last_error.clone())
        };
        assert_eq!(state, "connecting");
        assert!(last_error.is_none());
        clear_sessions_for_tests().await;
    }

    #[tokio::test]
    async fn cancelled_master_exit_is_not_a_connection_failure() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let hostname = "appleseed.example";
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "johnny".to_string(),
                hostname: hostname.to_string(),
                port: 22,
                destination: hostname.to_string(),
                state: "connecting".to_string(),
                line: format!("Connecting to {hostname} port 22."),
                last_error: None,
                master_alive: false,
            },
            paths,
            dir.path().join("cm-cancel"),
        )
        .await;
        let key = session_key("johnny", hostname, 22);
        let generation = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            record.user_cancelled.store(true, Ordering::SeqCst);
            record.master_generation
        };
        let copy = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            apply_master_exit(record, generation, hostname, "Connection closed", false)
        };
        assert!(copy.is_none());
        let (state, last_error) = {
            let sessions = SESSIONS.lock().await;
            let record = sessions.get(&key).expect("session");
            (record.state.clone(), record.last_error.clone())
        };
        assert_eq!(state, "disconnected");
        assert!(last_error.is_none());
        clear_sessions_for_tests().await;
    }

    #[tokio::test]
    async fn newer_connect_keeps_its_control_socket() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let hostname = "appleseed.example";
        let dir = tempdir().expect("tempdir");
        let socket = dir.path().join("cm-live");
        std::fs::write(&socket, b"live").expect("socket");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "johnny".to_string(),
                hostname: hostname.to_string(),
                port: 22,
                destination: hostname.to_string(),
                state: "connected".to_string(),
                line: format!("Connected as johnny@{hostname}."),
                last_error: None,
                master_alive: true,
            },
            paths,
            socket.clone(),
        )
        .await;
        let key = session_key("johnny", hostname, 22);
        let stale = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            let stale = record.master_generation;
            record.master_generation = next_master_generation();
            stale
        };
        remove_control_socket_if_owned(&key, stale, &socket).await;
        assert!(socket.is_file(), "stale disconnect removed the new socket");
        let current = SESSIONS
            .lock()
            .await
            .get(&key)
            .expect("session")
            .master_generation;
        remove_control_socket_if_owned(&key, current, &socket).await;
        assert!(!socket.exists());
        clear_sessions_for_tests().await;
    }

    #[tokio::test]
    async fn stale_connect_failure_does_not_clobber_a_newer_session() {
        let _lock = SESSION_TEST_LOCK.lock().await;
        clear_sessions_for_tests().await;
        let hostname = "appleseed.example";
        let dir = tempdir().expect("tempdir");
        let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
        insert_test_session(
            SshSessionStatus {
                user: "johnny".to_string(),
                hostname: hostname.to_string(),
                port: 2222,
                destination: hostname.to_string(),
                state: "connecting".to_string(),
                line: format!("Connecting to {hostname} port 2222."),
                last_error: None,
                master_alive: false,
            },
            paths,
            dir.path().join("cm-stale-fail"),
        )
        .await;
        let key = session_key("johnny", hostname, 2222);
        let stale = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            let stale = record.master_generation;
            record.master_generation = next_master_generation();
            record.state = "connected".to_string();
            record.master_alive = true;
            stale
        };
        let wrote = {
            let mut sessions = SESSIONS.lock().await;
            let record = sessions.get_mut(&key).expect("session");
            record_connect_failure(
                record,
                stale,
                SshErrorCopy::new("Could not connect to appleseed.example.", "old"),
            )
        };
        assert!(!wrote);
        let (state, alive, last_error) = {
            let sessions = SESSIONS.lock().await;
            let record = sessions.get(&key).expect("session");
            (
                record.state.clone(),
                record.master_alive,
                record.last_error.clone(),
            )
        };
        assert_eq!(state, "connected");
        assert!(alive);
        assert!(last_error.is_none());
        clear_sessions_for_tests().await;
    }
}
