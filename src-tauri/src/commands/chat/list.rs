use tauri::State;

use super::meta::ChatMeta;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub async fn list_chats(
    db: State<'_, AppDb>,
    project_slug: String,
) -> Result<Vec<ChatMeta>, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::list_chats_for_slug(&conn, &project_slug)
    })
    .await
    .map_err(|e| e.to_string())?
}