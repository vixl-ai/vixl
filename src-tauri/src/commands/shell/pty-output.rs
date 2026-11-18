use std::io::Read;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// Coalescing window for PTY output. One event per window keeps the webview
/// eval rate bounded during verbose builds while staying below a frame at 60Hz.
const FLUSH_WINDOW: Duration = Duration::from_millis(16);
/// Flush early when a burst is large so memory stays bounded.
const MAX_BATCH_BYTES: usize = 64 * 1024;

/// Forwards PTY output to the webview in coalesced batches.
///
/// The reader thread blocks on the PTY master; a second thread batches reads
/// inside a short window so a chatty process produces roughly one event per
/// frame instead of one per 4KB read. Bytes are decoded once per batch, which
/// also avoids splitting multi-byte UTF-8 characters across reads.
pub fn spawn_output_forwarder(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    if tx.send(buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // Dropping tx signals end-of-output to the forwarder.
    });

    std::thread::spawn(move || {
        let event_name = format!("pty-output-{session_id}");
        let mut batch: Vec<u8> = Vec::new();
        while let Ok(bytes) = rx.recv() {
            batch.extend_from_slice(&bytes);
            let deadline = Instant::now() + FLUSH_WINDOW;
            while batch.len() < MAX_BATCH_BYTES {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    break;
                };
                match rx.recv_timeout(remaining) {
                    Ok(bytes) => batch.extend_from_slice(&bytes),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        emit_batch(&app, &event_name, &mut batch);
                        emit_exit(&app, &session_id);
                        return;
                    }
                }
            }
            emit_batch(&app, &event_name, &mut batch);
        }
        emit_batch(&app, &event_name, &mut batch);
        emit_exit(&app, &session_id);
    });
}

fn emit_batch(app: &AppHandle, event_name: &str, batch: &mut Vec<u8>) {
    if batch.is_empty() {
        return;
    }
    let data = String::from_utf8_lossy(batch).into_owned();
    batch.clear();
    let _ = app.emit(event_name, data);
}

fn emit_exit(app: &AppHandle, session_id: &str) {
    let _ = app.emit(
        &format!("pty-exit-{session_id}"),
        serde_json::json!({ "sessionId": session_id }),
    );
}