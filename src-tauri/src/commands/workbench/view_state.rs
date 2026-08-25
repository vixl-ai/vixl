use tauri::State;

use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn editor_load_view_state(
    db: State<AppDb>,
    project_id: String,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let conn = db.lock()?;
    store::load_view_state(&conn, &project_id, &path)
}

#[tauri::command]
pub fn editor_save_view_state(
    db: State<AppDb>,
    project_id: String,
    path: String,
    view_state: serde_json::Value,
) -> Result<(), String> {
    let conn = db.lock()?;
    store::save_view_state(&conn, &project_id, &path, &view_state)
}
