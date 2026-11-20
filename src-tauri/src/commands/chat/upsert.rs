use tauri::{AppHandle, State};

use super::store;
use super::todo_line::line_is_todo_update;
use crate::db::AppDb;

#[tauri::command]
pub async fn upsert_chat_line(
    app: AppHandle,
    db: State<'_, AppDb>,
    project_slug: String,
    chat_id: String,
    line: serde_json::Value,
) -> Result<(), String> {
    let refresh = line_is_todo_update(&line);
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = conn.lock()?;
        store::require_chat(&conn, &project_slug, &chat_id)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        store::upsert_message_value(&tx, &chat_id, &line)?;
        store::bump_updated_at(&tx, &project_slug, &chat_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    if refresh {
        crate::tray::request_agents_refresh(&app);
    }
    Ok(())
}