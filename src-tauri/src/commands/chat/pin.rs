use tauri::{AppHandle, State};

use super::meta::{now_iso, ChatMeta};
use super::store;
use super::update::update_chat_meta_blocking;
use crate::db::AppDb;

#[tauri::command]
pub async fn pin_chat(
    app: AppHandle,
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
    pinned: bool,
) -> Result<ChatMeta, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        update_chat_meta_blocking(
            &app,
            conn,
            project_slug,
            chat_id,
            serde_json::json!({
              "pinned": pinned,
              "pinnedAt": if pinned { Some(now_iso()) } else { None::<String> }
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_pinned_chats(db: State<'_, AppDb>) -> Result<Vec<ChatMeta>, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::list_pinned_chats(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}