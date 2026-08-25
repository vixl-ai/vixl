use std::fs;

use tauri::{AppHandle, State};

use super::paths::chat_dir_path;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn delete_chat(
    app: AppHandle,
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<(), String> {
    let dir = chat_dir_path(&app, &project_slug, &chat_id)?;
    {
        let conn = db.lock()?;
        store::delete_chat(&conn, &project_slug, &chat_id)?;
    }
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
