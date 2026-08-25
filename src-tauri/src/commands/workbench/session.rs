use tauri::State;

use super::store;
use super::types::{WorkbenchSession, WorkbenchTabInput};
use crate::db::AppDb;

#[tauri::command]
pub fn workbench_load_session(db: State<AppDb>) -> Result<WorkbenchSession, String> {
    let conn = db.lock()?;
    store::load_session(&conn)
}

#[tauri::command]
pub fn workbench_replace_session(
    db: State<AppDb>,
    tabs: Vec<WorkbenchTabInput>,
    active_tab_id: Option<String>,
    right_sidebar_open: Option<bool>,
) -> Result<(), String> {
    let conn = db.lock()?;
    store::replace_session(&conn, &tabs, active_tab_id.as_deref(), right_sidebar_open)
}
