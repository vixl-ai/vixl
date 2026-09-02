use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::parse::{parse_callback_request, OAuthCallbackPayload};
use super::state::{OAuthLoopbackSession, OAuthLoopbackState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLoopbackStart {
    pub port: u16,
    pub redirect_url: String,
}

fn require_flow_id(flow_id: &str) -> Result<String, String> {
    let trimmed = flow_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("OAuth loopback flow id is required".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn oauth_begin_loopback(
    app: AppHandle,
    state: State<'_, OAuthLoopbackState>,
    flow_id: String,
) -> Result<OAuthLoopbackStart, String> {
    let flow_id = require_flow_id(&flow_id)?;
    state.cancel_flow(&flow_id).await;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Failed to bind OAuth loopback: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read OAuth loopback port: {error}"))?
        .port();
    let redirect_url = format!("http://127.0.0.1:{port}/callback");

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let flow_id_for_task = flow_id.clone();
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

        let payload = match parse_callback_request(&request, port) {
            Ok(parsed) => parsed.with_flow_id(flow_id_for_task.clone()),
            Err(message) => OAuthCallbackPayload::protocol_error(message, flow_id_for_task.clone()),
        };
        let _ = app.emit("oauth-callback", payload);

        if let Some(state) = app.try_state::<OAuthLoopbackState>() {
            let _ = state.take_session(&flow_id_for_task);
        }
    });

    state.store_session(
        flow_id,
        OAuthLoopbackSession {
            cancel: cancel_tx,
            join,
        },
    )?;

    Ok(OAuthLoopbackStart { port, redirect_url })
}

#[tauri::command]
pub async fn oauth_cancel_loopback(
    state: State<'_, OAuthLoopbackState>,
    flow_id: String,
) -> Result<(), String> {
    let flow_id = require_flow_id(&flow_id)?;
    state.cancel_flow(&flow_id).await;
    Ok(())
}
