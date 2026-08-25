use tauri::State;

use super::meta::{now_iso, ChatMeta};
use super::store;
use super::update::update_chat_meta;
use crate::db::AppDb;

#[tauri::command]
pub fn pin_chat(
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
    pinned: bool,
) -> Result<ChatMeta, String> {
    update_chat_meta(
        db,
        project_slug,
        chat_id,
        serde_json::json!({
          "pinned": pinned,
          "pinnedAt": if pinned { Some(now_iso()) } else { None::<String> }
        }),
    )
}

#[tauri::command]
pub fn list_pinned_chats(db: State<AppDb>) -> Result<Vec<ChatMeta>, String> {
    let conn = db.lock()?;
    store::list_pinned_chats(&conn)
}
