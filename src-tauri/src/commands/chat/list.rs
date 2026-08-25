use tauri::State;

use super::meta::ChatMeta;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn list_chats(db: State<AppDb>, project_slug: String) -> Result<Vec<ChatMeta>, String> {
    let conn = db.lock()?;
    store::list_chats_for_slug(&conn, &project_slug)
}
