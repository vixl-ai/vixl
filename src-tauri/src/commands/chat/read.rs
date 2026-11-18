use tauri::State;

use super::meta::ChatMeta;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub async fn read_chat_meta(
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<ChatMeta, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        Ok(store::get_chat(&conn, &project_slug, &chat_id)?.meta)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_chat_messages(
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::get_chat(&conn, &project_slug, &chat_id)?;
        store::list_messages(&conn, &chat_id)
    })
    .await
    .map_err(|e| e.to_string())?
}