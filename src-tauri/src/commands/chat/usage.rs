use tauri::State;

use super::store;
use crate::db::AppDb;

#[tauri::command]
pub async fn read_chat_usage(
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::require_chat(&conn, &project_slug, &chat_id)?;
        store::list_usage(&conn, &chat_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_chat_usage(
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
    records: Vec<serde_json::Value>,
) -> Result<(), String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::require_chat(&conn, &project_slug, &chat_id)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        store::replace_usage(&tx, &chat_id, &records)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}