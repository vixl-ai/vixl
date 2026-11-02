use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use super::askpass::{
    classify_askpass, secret_kind_is_saveable, AskpassKind, AskpassResponse, SecretKind,
};
use super::auth::{AuthAttempt, SecretDisposition};
use super::events::{emit_confirm, emit_secret, emit_status, SshConfirmEvent, SshSecretEvent};
use super::known_hosts::{also_add_new_vixl_lines, parse_confirm_metadata};
use super::paths::SshPaths;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PromptAnswer {
    Confirm { trusted: bool, also_add: bool },
    Secret(String),
    Cancel,
    Abort,
}

struct PendingPrompt {
    tx: oneshot::Sender<PromptAnswer>,
}

lazy_static::lazy_static! {
    static ref PENDING: Mutex<HashMap<String, PendingPrompt>> = Mutex::new(HashMap::new());
}

pub struct ConnectCtx {
    pub auth: Mutex<AuthAttempt>,
    pub paths: SshPaths,
    pub known_hosts_before: String,
    pub also_add: AtomicBool,
    pub user_cancelled: Arc<AtomicBool>,
    pub stderr: Mutex<String>,
    pub user: String,
    pub hostname: String,
    pub port: u16,
    pub identity_basename: Option<String>,
}

pub async fn answer_confirm(
    request_id: String,
    trusted: bool,
    also_add: bool,
) -> Result<(), String> {
    let pending = PENDING.lock().await.remove(&request_id);
    let Some(pending) = pending else {
        return Err("SSH confirm prompt is no longer open".to_string());
    };
    pending
        .tx
        .send(PromptAnswer::Confirm { trusted, also_add })
        .map_err(|_| "SSH confirm prompt is no longer open".to_string())
}

pub async fn answer_secret(request_id: String, value: String) -> Result<(), String> {
    let pending = PENDING.lock().await.remove(&request_id);
    let Some(pending) = pending else {
        return Err("SSH secret prompt is no longer open".to_string());
    };
    pending
        .tx
        .send(PromptAnswer::Secret(value))
        .map_err(|_| "SSH secret prompt is no longer open".to_string())
}

pub async fn cancel_prompt(request_id: String) -> Result<(), String> {
    let pending = PENDING.lock().await.remove(&request_id);
    let Some(pending) = pending else {
        return Err("SSH prompt is no longer open".to_string());
    };
    pending
        .tx
        .send(PromptAnswer::Cancel)
        .map_err(|_| "SSH prompt is no longer open".to_string())
}

pub async fn cancel_all_prompts() {
    let mut pending = PENDING.lock().await;
    for (_, waiter) in pending.drain() {
        let _ = waiter.tx.send(PromptAnswer::Abort);
    }
}

async fn wait_for_user(request_id: String) -> PromptAnswer {
    let (tx, rx) = oneshot::channel();
    PENDING
        .lock()
        .await
        .insert(request_id, PendingPrompt { tx });
    rx.await.unwrap_or(PromptAnswer::Abort)
}

fn askpass_from_prompt_answer(answer: PromptAnswer) -> (AskpassResponse, bool) {
    match answer {
        PromptAnswer::Confirm {
            trusted: true,
            also_add,
        } => (AskpassResponse::Submit("yes".to_string()), also_add),
        PromptAnswer::Confirm { trusted: false, .. } => (AskpassResponse::Cancel, false),
        PromptAnswer::Secret(value) => (AskpassResponse::Submit(value), false),
        PromptAnswer::Cancel | PromptAnswer::Abort => (AskpassResponse::Cancel, false),
    }
}

#[cfg(unix)]
fn peer_uid_ok(stream: &tokio::net::UnixStream) -> bool {
    use std::os::unix::io::AsRawFd;
    let fd = stream.as_raw_fd();
    let Some(uid) = peer_uid(fd) else {
        return false;
    };
    uid == unsafe { libc::getuid() }
}

#[cfg(unix)]
fn peer_uid(fd: i32) -> Option<u32> {
    #[cfg(target_os = "linux")]
    {
        let mut cred = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                &mut cred as *mut _ as *mut libc::c_void,
                &mut len,
            )
        };
        if rc == 0 {
            Some(cred.uid)
        } else {
            None
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut cred: libc::xucred = unsafe { std::mem::zeroed() };
        cred.cr_version = libc::XUCRED_VERSION;
        let mut len = std::mem::size_of::<libc::xucred>() as libc::socklen_t;
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_LOCAL,
                libc::LOCAL_PEERCRED,
                &mut cred as *mut _ as *mut libc::c_void,
                &mut len,
            )
        };
        if rc == 0 {
            Some(cred.cr_uid)
        } else {
            None
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = fd;
        Some(unsafe { libc::getuid() })
    }
}

#[cfg(unix)]
async fn write_response(
    stream: &mut tokio::net::UnixStream,
    response: &AskpassResponse,
) -> std::io::Result<()> {
    match response {
        AskpassResponse::Submit(value) => {
            write_lp_async(stream, "ok").await?;
            write_lp_async(stream, value).await
        }
        AskpassResponse::Cancel => {
            write_lp_async(stream, "cancel").await?;
            write_lp_async(stream, "").await
        }
    }
}

#[cfg(unix)]
async fn write_lp_async(stream: &mut tokio::net::UnixStream, value: &str) -> std::io::Result<()> {
    let bytes = value.as_bytes();
    stream
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .await?;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(unix)]
async fn read_lp_async(stream: &mut tokio::net::UnixStream) -> std::io::Result<String> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 64 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "askpass payload too large",
        ));
    }
    let mut buf = vec![0u8; len];
    if len > 0 {
        stream.read_exact(&mut buf).await?;
    }
    String::from_utf8(buf).map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
}

#[cfg(unix)]
pub async fn serve_askpass_client(
    mut stream: tokio::net::UnixStream,
    app: Option<tauri::AppHandle>,
    ctx: Arc<ConnectCtx>,
) {
    if !peer_uid_ok(&stream) {
        let _ = write_response(&mut stream, &AskpassResponse::Cancel).await;
        return;
    }
    let prompt_env = match read_lp_async(&mut stream).await {
        Ok(value) => value,
        Err(_) => return,
    };
    let prompt = match read_lp_async(&mut stream).await {
        Ok(value) => value,
        Err(_) => return,
    };
    let classified = classify_askpass(Some(prompt_env.as_str()).filter(|s| !s.is_empty()), &prompt);
    let stderr = ctx.stderr.lock().await.clone();
    if super::errors::looks_like_host_key_changed(&stderr) {
        ctx.auth.lock().await.note_host_key_changed();
    }
    let response = match classified.kind {
        AskpassKind::Confirm => {
            if ctx.auth.lock().await.host_key_blocked() {
                AskpassResponse::Cancel
            } else {
                let meta = parse_confirm_metadata(&prompt, &stderr);
                let request_id = Uuid::new_v4().to_string();
                emit_confirm(
                    app.as_ref(),
                    &SshConfirmEvent {
                        request_id: request_id.clone(),
                        hostname: meta.host.clone().unwrap_or_else(|| ctx.hostname.clone()),
                        port: meta.port.unwrap_or(ctx.port),
                        fingerprint: meta.fingerprint,
                        key_type: meta.key_type,
                        prompt: prompt.clone(),
                        address: meta.address,
                    },
                );
                let answer = wait_for_user(request_id).await;
                if matches!(answer, PromptAnswer::Cancel) {
                    ctx.user_cancelled.store(true, Ordering::SeqCst);
                }
                let (response, also_add) = askpass_from_prompt_answer(answer);
                if also_add {
                    ctx.also_add.store(true, Ordering::SeqCst);
                }
                if matches!(response, AskpassResponse::Cancel)
                    && !ctx.user_cancelled.load(Ordering::SeqCst)
                {
                    ctx.auth.lock().await.note_host_key_rejected();
                } else if also_add {
                    let paths = ctx.paths.clone();
                    let before = ctx.known_hosts_before.clone();
                    tokio::spawn(async move {
                        for _ in 0..40 {
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            if let Ok(added) = also_add_new_vixl_lines(&paths, &before, true) {
                                if !added.is_empty() {
                                    break;
                                }
                            }
                        }
                    });
                }
                response
            }
        }
        AskpassKind::Secret => {
            let kind = classified.secret_kind.unwrap_or(SecretKind::Other);
            let disposition = ctx.auth.lock().await.take_secret(kind);
            match disposition {
                SecretDisposition::Cancel => AskpassResponse::Cancel,
                SecretDisposition::Submit(value) => {
                    let line = match kind {
                        SecretKind::Passphrase => {
                            let name = ctx
                                .identity_basename
                                .clone()
                                .unwrap_or_else(|| "the key".to_string());
                            format!("Using the saved passphrase for {name}.")
                        }
                        SecretKind::Password => format!(
                            "Using the saved password for {user}@{host}.",
                            user = ctx.user,
                            host = ctx.hostname
                        ),
                        _ => format!("Connecting to {} port {}.", ctx.hostname, ctx.port),
                    };
                    emit_status(
                        app.as_ref(),
                        &super::events::SshStatusEvent {
                            user: ctx.user.clone(),
                            hostname: ctx.hostname.clone(),
                            port: ctx.port,
                            line,
                        },
                    );
                    AskpassResponse::Submit(value)
                }
                SecretDisposition::AskUser { saveable } => {
                    let request_id = Uuid::new_v4().to_string();
                    emit_secret(
                        app.as_ref(),
                        &SshSecretEvent {
                            request_id: request_id.clone(),
                            hostname: ctx.hostname.clone(),
                            port: ctx.port,
                            prompt: prompt.clone(),
                            kind,
                            saveable: saveable && secret_kind_is_saveable(kind),
                        },
                    );
                    let answer = wait_for_user(request_id).await;
                    if matches!(answer, PromptAnswer::Cancel) {
                        ctx.user_cancelled.store(true, Ordering::SeqCst);
                    }
                    askpass_from_prompt_answer(answer).0
                }
            }
        }
    };
    let _ = write_response(&mut stream, &response).await;
}

#[cfg(unix)]
pub async fn run_askpass_listener(
    sock_path: std::path::PathBuf,
    app: Option<tauri::AppHandle>,
    ctx: Arc<ConnectCtx>,
    mut stop: tokio::sync::watch::Receiver<bool>,
) {
    let _ = std::fs::remove_file(&sock_path);
    if let Some(parent) = sock_path.parent() {
        let _ = super::paths::ensure_dir_mode_0700(parent);
    }
    let listener = match tokio::net::UnixListener::bind(&sock_path) {
        Ok(listener) => listener,
        Err(_) => return,
    };
    let _ = super::paths::set_mode_0600(&sock_path);
    loop {
        tokio::select! {
            _ = stop.changed() => {
                if *stop.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let app = app.clone();
                        let ctx = ctx.clone();
                        tokio::spawn(async move {
                            serve_askpass_client(stream, app, ctx).await;
                        });
                    }
                    Err(_) => break,
                }
            }
        }
    }
    let _ = std::fs::remove_file(&sock_path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ssh::askpass::encode_helper_stdio;

    #[test]
    fn confirm_also_add_is_beside_yes() {
        let (response, also_add) = askpass_from_prompt_answer(PromptAnswer::Confirm {
            trusted: true,
            also_add: true,
        });
        assert_eq!(response, AskpassResponse::Submit("yes".to_string()));
        assert!(also_add);
        match &response {
            AskpassResponse::Submit(value) => {
                assert_eq!(value, "yes");
                assert!(!value.contains("also_add"));
            }
            AskpassResponse::Cancel => panic!("trusted confirm must submit yes"),
        }
        let (code, stdout) = encode_helper_stdio(&response);
        assert_eq!(code, 0);
        assert_eq!(stdout, b"yes\n");

        let (rejected, also) = askpass_from_prompt_answer(PromptAnswer::Confirm {
            trusted: false,
            also_add: true,
        });
        assert_eq!(rejected, AskpassResponse::Cancel);
        assert!(!also);
        let (code, stdout) = encode_helper_stdio(&rejected);
        assert_eq!(code, 1);
        assert!(stdout.is_empty());
    }

    #[tokio::test]
    async fn answer_confirm_passes_also_add_flag() {
        let request_id = "confirm-also-add".to_string();
        let waiter = tokio::spawn(wait_for_user(request_id.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        answer_confirm(request_id, true, true)
            .await
            .expect("answer");
        let answer = waiter.await.expect("join");
        assert_eq!(
            answer,
            PromptAnswer::Confirm {
                trusted: true,
                also_add: true
            }
        );
    }
}
