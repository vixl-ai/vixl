use std::fs;

use tauri::{AppHandle, State};

use super::paths::chat_dir_path;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub async fn delete_chat(
    app: AppHandle,
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<(), String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let dir = chat_dir_path(&app, &project_slug, &chat_id)?;
        {
            let conn = conn.lock()?;
            store::delete_chat(&conn, &project_slug, &chat_id)?;
        }
        crate::tray::request_agents_refresh(&app);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}