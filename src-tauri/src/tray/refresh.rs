use std::sync::Mutex;
use std::time::Duration;

use lazy_static::lazy_static;
use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;

/// Tray refreshes are coalesced: a burst of chat writes schedules one rebuild.
const REFRESH_DEBOUNCE: Duration = Duration::from_millis(250);

lazy_static! {
    static ref PENDING: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
}

/// Schedules a debounced tray menu rebuild on the main thread. Safe to call
/// from any thread; bursts collapse into a single rebuild.
pub fn request_refresh(app: &AppHandle) {
    let Ok(mut pending) = PENDING.lock() else {
        return;
    };
    if let Some(handle) = pending.take() {
        handle.abort();
    }
    let app = app.clone();
    *pending = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REFRESH_DEBOUNCE).await;
        let rebuild_app = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) = super::refresh_agents(&rebuild_app) {
                log::error!("Failed to refresh tray agents: {error}");
            }
        }) {
            log::error!("Failed to schedule tray refresh: {error}");
        }
    }));
}