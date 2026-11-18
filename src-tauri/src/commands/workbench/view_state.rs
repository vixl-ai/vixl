use tauri::State;

use super::store;
use crate::db::AppDb;

#[tauri::command]
pub async fn editor_load_view_state(
    db: State<'_, AppDb>,
    project_id: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::load_view_state(&conn, &project_id, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn editor_save_view_state(
    db: State<'_, AppDb>,
    project_id: String,
    path: String,
    view_state: serde_json::Value,
) -> Result<(), String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::save_view_state(&conn, &project_id, &path, &view_state)
    })
    .await
    .map_err(|e| e.to_string())?
}