use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::commands::fs::{
    parse_ssh_project_root, resolve_command_path, validate_relative, WorkspaceRootArg,
};
use crate::commands::mcp::merged_shell_path;
use crate::commands::ssh::{
    is_ssh_root, key_for, map_unreachable, tty_argv_on_master, tty_login_command, SSH_BIN,
};

pub fn resolve_pty_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
}

pub fn pty_shell_args() -> &'static [&'static str] {
    #[cfg(unix)]
    {
        &["-l"]
    }
    #[cfg(windows)]
    {
        &[]
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub session_id: String,
}

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

lazy_static::lazy_static! {
  static ref PTY_SESSIONS: Mutex<HashMap<String, Arc<Mutex<PtySession>>>> =
    Mutex::new(HashMap::new());
}

#[tauri::command]
pub async fn shell_spawn_pty(
    app: AppHandle,
    project_root: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    project_roots: Option<Vec<WorkspaceRootArg>>,
) -> Result<PtySessionInfo, String> {
    if is_ssh_root(&project_root) {
        return spawn_remote_pty(app, project_root, cols, rows, cwd).await;
    }

    let merged_path = tauri::async_runtime::spawn_blocking(merged_shell_path)
        .await
        .map_err(|e| e.to_string())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(resolve_pty_shell());
    cmd.args(pty_shell_args());
    let work_dir = match cwd {
        Some(relative_cwd) => resolve_command_path(
            &project_root,
            project_roots.as_deref(),
            &relative_cwd,
        )?
        .path
        .to_string_lossy()
        .to_string(),
        None => project_root,
    };
    cmd.cwd(work_dir);
    if let Some(merged) = merged_path {
        cmd.env("PATH", merged);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env_remove("GIT_DIR");
    cmd.env_remove("GIT_WORK_TREE");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    register_pty_session(app, pair, child)
}

async fn spawn_remote_pty(
    app: AppHandle,
    project_root: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<PtySessionInfo, String> {
    let ssh = parse_ssh_project_root(&project_root)?;
    let remote_cwd = match cwd.as_deref() {
        Some(relative) if !relative.trim().is_empty() && relative.trim() != "." => {
            let parts = validate_relative(relative, &ssh.hostname)?;
            let mut path = ssh.remote_path.trim_end_matches('/').to_string();
            for part in parts {
                path.push('/');
                path.push_str(&part);
            }
            path
        }
        _ => ssh.remote_path.clone(),
    };
    let argv = tty_argv_on_master(key_for(&ssh), Some(tty_login_command(&remote_cwd)))
        .await
        .map_err(|err| map_unreachable(&ssh.hostname, err))?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(SSH_BIN);
    cmd.args(argv.args);
    cmd.env("TERM", "xterm-256color");
    cmd.env_remove("GIT_DIR");
    cmd.env_remove("GIT_WORK_TREE");
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| map_unreachable(&ssh.hostname, err.to_string()))?;
    register_pty_session(app, pair, child)
}

fn register_pty_session(
    app: AppHandle,
    pair: portable_pty::PtyPair,
    child: Box<dyn portable_pty::Child + Send>,
) -> Result<PtySessionInfo, String> {
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session_id = Uuid::new_v4().to_string();
    let event_name = format!("pty-output-{session_id}");
    let app_handle = app.clone();
    let sid = session_id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let _ = app_handle.emit(&event_name, data);
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(
            &format!("pty-exit-{sid}"),
            serde_json::json!({ "sessionId": sid }),
        );
    });

    PTY_SESSIONS.lock().unwrap().insert(
        session_id.clone(),
        Arc::new(Mutex::new(PtySession {
            master: pair.master,
            writer,
            child,
        })),
    );

    Ok(PtySessionInfo { session_id })
}

#[tauri::command]
pub fn shell_write_pty(session_id: String, data: String) -> Result<(), String> {
    let session = {
        let sessions = PTY_SESSIONS.lock().unwrap();
        sessions
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "PTY session not found".to_string())?
    };
    let mut guard = session.lock().unwrap();
    guard
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    guard.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_resize_pty(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = PTY_SESSIONS.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "PTY session not found".to_string())?;
    let guard = session.lock().unwrap();
    guard
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_kill_pty(session_id: String) -> Result<(), String> {
    let session = PTY_SESSIONS.lock().unwrap().remove(&session_id);
    if let Some(session) = session {
        let mut guard = session.lock().unwrap();
        let _ = guard.child.kill();
    }
    Ok(())
}
