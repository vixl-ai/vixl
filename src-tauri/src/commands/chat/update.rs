use tauri::State;

use super::meta::{now_iso, ChatMeta};
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn update_chat_meta(
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
    patch: serde_json::Value,
) -> Result<ChatMeta, String> {
    let conn = db.lock()?;
    let record = store::get_chat(&conn, &project_slug, &chat_id)?;
    let mut meta = serde_json::to_value(&record.meta).map_err(|e| e.to_string())?;
    if let Some(obj) = patch.as_object() {
        for (key, value) in obj {
            meta[key] = value.clone();
        }
    }
    meta["updatedAt"] = serde_json::Value::String(now_iso());
    let updated: ChatMeta = serde_json::from_value(meta).map_err(|e| e.to_string())?;
    store::update_chat(&conn, &updated, &record.project_id)?;
    Ok(updated)
}
