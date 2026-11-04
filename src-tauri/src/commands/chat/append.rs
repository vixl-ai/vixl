use tauri::{AppHandle, State};

use super::store;
use super::todo_line::line_is_todo_update;
use crate::db::AppDb;

#[tauri::command]
pub fn append_chat_line(
    app: AppHandle,
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
    line: serde_json::Value,
) -> Result<(), String> {
    let refresh = line_is_todo_update(&line);
    {
        let conn = db.lock()?;
        store::get_chat(&conn, &project_slug, &chat_id)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let seq = store::next_seq(&tx, &chat_id)?;
        store::insert_message_value(&tx, &chat_id, seq, &line)?;
        store::bump_updated_at(&tx, &project_slug, &chat_id)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if refresh {
        if let Err(error) = crate::tray::refresh_agents(&app) {
            log::error!("Failed to refresh tray agents: {error}");
        }
    }
    Ok(())
}
