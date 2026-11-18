use tauri::State;

use super::store;
use super::types::{WorkbenchSession, WorkbenchTabInput};
use crate::db::AppDb;

#[tauri::command]
pub async fn workbench_load_session(db: State<'_, AppDb>) -> Result<WorkbenchSession, String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::load_session(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn workbench_replace_session(
    db: State<'_, AppDb>,
    tabs: Vec<WorkbenchTabInput>,
    active_tab_id: Option<String>,
    right_sidebar_open: Option<bool>,
) -> Result<(), String> {
    let conn = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = conn.lock()?;
        store::replace_session(&conn, &tabs, active_tab_id.as_deref(), right_sidebar_open)
    })
    .await
    .map_err(|e| e.to_string())?
}