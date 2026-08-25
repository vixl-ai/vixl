use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLoopbackStart {
    pub port: u16,
    pub redirect_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCallbackPayload {
    code: String,
    state: String,
    error: Option<String>,
}

struct OAuthLoopbackSession {
    cancel: oneshot::Sender<()>,
    join: JoinHandle<()>,
}

#[derive(Default)]
pub struct OAuthLoopbackState {
    inner: Mutex<Option<OAuthLoopbackSession>>,
}

impl OAuthLoopbackState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    fn take_session(&self) -> Option<OAuthLoopbackSession> {
        self.inner.lock().ok()?.take()
    }

    fn store_session(&self, session: OAuthLoopbackSession) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "OAuth loopback state lock poisoned".to_string())?;
        *guard = Some(session);
        Ok(())
    }
}

fn parse_callback_request(request: &str) -> Result<(String, String), String> {
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "Empty OAuth callback request".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;
    let path = parts
        .next()
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;

    if !method.eq_ignore_ascii_case("GET") {
        return Err("OAuth callback must be GET".to_string());
    }

    let url = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|error| format!("Invalid OAuth callback path: {error}"))?;

    if url.path() != "/callback" {
        return Err("OAuth callback path must be /callback".to_string());
    }

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut oauth_error: Option<String> = None;
    for (key, value) in url.query_pairs() {
        if key == "code" {
            code = Some(value.into_owned());
        } else if key == "state" {
            state = Some(value.into_owned());
        } else if key == "error" {
            oauth_error = Some(value.into_owned());
        }
    }

    if let Some(error) = oauth_error {
        return Err(format!("OAuth authorization failed: {error}"));
    }

    let code = code.ok_or_else(|| "OAuth callback missing code".to_string())?;
    let state = state.ok_or_else(|| "OAuth callback missing state".to_string())?;
    Ok((code, state))
}

async fn cancel_existing(state: &OAuthLoopbackState) {
    if let Some(session) = state.take_session() {
        let _ = session.cancel.send(());
        let _ = session.join.await;
    }
}

#[tauri::command]
pub fn open_external_url(url: String, allowed_origin: Option<String>) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    let scheme = parsed.scheme();
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let is_loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";

    if scheme == "http" {
        if !is_loopback {
            return Err("http URLs may only be opened for localhost".to_string());
        }
    } else if scheme != "https" {
        return Err("Only https URLs can be opened (or http localhost)".to_string());
    }

    let Some(allowed) = allowed_origin.filter(|value| !value.trim().is_empty()) else {
        return Err("allowed_origin is required to open external URLs".to_string());
    };

    let allowed_parsed =
        Url::parse(&allowed).map_err(|error| format!("Invalid allowed origin: {error}"))?;
    if parsed.origin() != allowed_parsed.origin() {
        return Err(format!(
            "URL origin {} does not match allowed origin {}",
            parsed.origin().ascii_serialization(),
            allowed_parsed.origin().ascii_serialization()
        ));
    }

    open::that_detached(url).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn oauth_begin_loopback(
    app: AppHandle,
    state: State<'_, OAuthLoopbackState>,
) -> Result<OAuthLoopbackStart, String> {
    cancel_existing(&state).await;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Failed to bind OAuth loopback: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read OAuth loopback port: {error}"))?
        .port();
    let redirect_url = format!("http://127.0.0.1:{port}/callback");

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        let accepted = tokio::select! {
          _ = &mut cancel_rx => None,
          result = listener.accept() => result.ok(),
        };

        let Some((mut stream, _)) = accepted else {
            return;
        };

        let mut buffer = vec![0u8; 8192];
        let read = match stream.read(&mut buffer).await {
            Ok(n) => n,
            Err(_) => return,
        };
        let request = String::from_utf8_lossy(&buffer[..read]);

        let body = "<!DOCTYPE html><html><body><p>You can close this window</p></body></html>";
        let response = format!(
      "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
      body.len(),
      body
    );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;

        match parse_callback_request(&request) {
            Ok((code, callback_state)) => {
                let _ = app.emit(
                    "oauth-callback",
                    OAuthCallbackPayload {
                        code,
                        state: callback_state,
                        error: None,
                    },
                );
            }
            Err(message) => {
                let _ = app.emit(
                    "oauth-callback",
                    OAuthCallbackPayload {
                        code: String::new(),
                        state: String::new(),
                        error: Some(message),
                    },
                );
            }
        }

        if let Some(state) = app.try_state::<OAuthLoopbackState>() {
            let _ = state.take_session();
        }
    });

    state.store_session(OAuthLoopbackSession {
        cancel: cancel_tx,
        join,
    })?;

    Ok(OAuthLoopbackStart { port, redirect_url })
}

#[tauri::command]
pub async fn oauth_cancel_loopback(state: State<'_, OAuthLoopbackState>) -> Result<(), String> {
    cancel_existing(&state).await;
    Ok(())
}
