mod argv;
mod askpass;
mod auth;
mod channels;
mod config;
mod errors;
mod events;
mod known_hosts;
mod orphan;
mod paths;
mod preview;
mod prompt;
mod remote_cmd;
mod session;
mod validate;
mod vault;

pub use argv::{
    argv_contains_forbidden, build_ssh_argv, ArgvRequest, ControlMasterMode, SshArgv,
    SshInvocation, TtyMode, PIN_OPTIONS,
};
pub use askpass::{
    classify_askpass, encode_helper_stdio, AskpassKind, AskpassResponse, SecretKind,
};
pub use auth::{AuthAttempt, SecretDisposition, FIXTURE_SSH_PASSWORD};
pub(crate) use channels::{
    channel_exit_rx, close_channel, open_exec, open_sftp, recv_channel_exit,
    take_channel_stdio, tty_argv_on_master, wait_channel_exit, ChannelStdio, SshExecResult,
};
pub use channels::{read_channel_stderr, read_channel_stdout, write_channel_stdin};
pub(crate) use remote_cmd::{
    block_on, exec_on, indexer_cannot_run, inotify_enospc, inotifywait_missing,
    is_ssh_root,
    join_remote_argv, key_for, login_command, looks_like_enospc, looks_like_missing_program,
    map_unreachable, missing_program, parse_root, posix_quote, probe_remote_program,
    reject_git_hooks_write, ssh_uri_for, tty_login_command,
};
pub use errors::looks_like_host_key_changed;
pub use known_hosts::{also_add_new_vixl_lines, remove_vixl_known_host_lines};
pub use paths::{require_socket_path_len, SshPaths, MAX_UNIX_SOCKET_BYTES, SSH_BIN};
pub use preview::SshPreview;
pub use session::{session_key, SessionKey, SshConnectRequest, SshSessionStatus};

#[cfg(test)]
pub(crate) use session::{
    clear_sessions_for_tests, connect, disconnect, insert_test_session, SESSION_TEST_LOCK,
};
pub use validate::validate_destination;
pub use vault::SshSavedIdentity;

use tauri::AppHandle;

use crate::commands::keychain::webview_secret_command_prepare;

use self::channels::SshChannelInfo;
use self::config::parse_host_aliases;

#[tauri::command]
pub fn ssh_list_aliases(config_file: Option<String>) -> Result<Vec<String>, String> {
    let path = match config_file {
        Some(path) => std::path::PathBuf::from(path),
        None => SshPaths::production()?.user_config(),
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(parse_host_aliases(&path).aliases)
}

#[tauri::command]
pub fn ssh_preview(
    destination: String,
    port: Option<u16>,
    identity_file: Option<String>,
    config_file: Option<String>,
    vixl_ssh_dir: Option<String>,
    user_ssh_dir: Option<String>,
) -> Result<SshPreview, String> {
    let destination = validate::validate_destination(&destination)?;
    let port = validate::validate_port(port)?;
    let paths = match (vixl_ssh_dir, user_ssh_dir) {
        (Some(vixl), Some(user)) => SshPaths::from_roots(vixl.into(), user.into()),
        _ => SshPaths::production()?,
    };
    preview::preview_destination(
        &paths,
        &destination,
        port,
        identity_file.as_deref(),
        config_file.as_deref(),
    )
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    request: SshConnectRequest,
) -> Result<SshSessionStatus, String> {
    session::connect(Some(app), request).await
}

#[tauri::command]
pub async fn ssh_disconnect(
    user: String,
    hostname: String,
    port: u16,
) -> Result<SshSessionStatus, String> {
    session::disconnect(&user, &hostname, port).await
}

#[tauri::command]
pub async fn ssh_session_status(
    user: String,
    hostname: String,
    port: u16,
) -> Result<SshSessionStatus, String> {
    Ok(session::session_status(&user, &hostname, port).await)
}

#[tauri::command]
pub async fn ssh_list_sessions() -> Result<Vec<SshSessionStatus>, String> {
    Ok(session::list_sessions().await)
}

#[tauri::command]
pub async fn ssh_cancel_connect(user: String, hostname: String, port: u16) -> Result<(), String> {
    session::cancel_connect(&user, &hostname, port).await
}

#[tauri::command]
pub async fn ssh_open_exec(
    user: String,
    hostname: String,
    port: u16,
    command: String,
) -> Result<SshChannelInfo, String> {
    channels::open_exec(session_key(&user, &hostname, port), command).await
}

#[tauri::command]
pub async fn ssh_exec(
    user: String,
    hostname: String,
    port: u16,
    command: String,
) -> Result<SshExecResult, String> {
    channels::exec_wait(session_key(&user, &hostname, port), command).await
}

#[tauri::command]
pub async fn ssh_open_sftp(
    user: String,
    hostname: String,
    port: u16,
) -> Result<SshChannelInfo, String> {
    channels::open_sftp(session_key(&user, &hostname, port)).await
}

#[tauri::command]
pub async fn ssh_open_tty(
    user: String,
    hostname: String,
    port: u16,
) -> Result<SshChannelInfo, String> {
    channels::open_tty(session_key(&user, &hostname, port), None).await
}

#[tauri::command]
pub async fn ssh_close_channel(channel_id: String) -> Result<(), String> {
    channels::close_channel(channel_id).await
}

#[tauri::command]
pub async fn ssh_open_local_forward(
    user: String,
    hostname: String,
    port: u16,
    bind_address: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), String> {
    channels::open_local_forward(
        session_key(&user, &hostname, port),
        bind_address,
        local_port,
        remote_host,
        remote_port,
    )
    .await
}

#[tauri::command]
pub async fn ssh_answer_confirm(
    request_id: String,
    trusted: bool,
    also_add: bool,
) -> Result<(), String> {
    prompt::answer_confirm(request_id, trusted, also_add).await
}

#[tauri::command]
pub async fn ssh_answer_secret(request_id: String, value: String) -> Result<(), String> {
    prompt::answer_secret(request_id, value).await
}

#[tauri::command]
pub async fn ssh_cancel_prompt(request_id: String) -> Result<(), String> {
    prompt::cancel_prompt(request_id).await
}

#[tauri::command]
pub fn ssh_remove_vixl_host_key(
    hostname: String,
    port: u16,
    vixl_ssh_dir: Option<String>,
) -> Result<usize, String> {
    let paths = match vixl_ssh_dir {
        Some(dir) => SshPaths::from_roots(
            dir.into(),
            std::path::PathBuf::from("/nonexistent-user-ssh"),
        ),
        None => SshPaths::production()?,
    };
    known_hosts::remove_vixl_known_host_lines(&paths.known_hosts(), &hostname, port)
}

pub use vault::{
    ssh_delete_passphrase, ssh_delete_password, ssh_list_saved_identities, ssh_save_passphrase,
    ssh_save_password,
};

pub fn webview_rejects_ssh_vault_key(key: &str) -> Result<(), String> {
    webview_secret_command_prepare(key)
}

#[cfg(test)]
mod sshd_tests;
#[cfg(test)]
mod remote_exec_tests;
