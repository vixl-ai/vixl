use tauri::State;

use super::meta::ChatMeta;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn read_chat_meta(
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<ChatMeta, String> {
    let conn = db.lock()?;
    Ok(store::get_chat(&conn, &project_slug, &chat_id)?.meta)
}

#[tauri::command]
pub fn read_chat_messages(
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock()?;
    store::get_chat(&conn, &project_slug, &chat_id)?;
    store::list_messages(&conn, &chat_id)
}
