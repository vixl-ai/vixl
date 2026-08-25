use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::types::{WorkbenchSession, WorkbenchSessionTab, WorkbenchTabInput};

pub const RIGHT_SIDEBAR_PREF_KEY: &str = "right_sidebar_open";

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn sanitize_payload(tab_type: &str, payload: &Value) -> Value {
    let mut payload = payload.clone();
    if let Some(object) = payload.as_object_mut() {
        object.remove("dirty");
        if tab_type == "terminal" {
            object.insert("sessionId".to_string(), Value::Null);
        }
    }
    payload
}

pub fn load_session(conn: &Connection) -> Result<WorkbenchSession, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, type, label, is_active, payload_json
             FROM workbench_tabs
             ORDER BY sort_order ASC",
        )
        .map_err(|error| format!("Failed to read workbench tabs: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| format!("Failed to query workbench tabs: {error}"))?;

    let mut tabs = Vec::new();
    let mut active_tab_id = None;
    for row in rows {
        let (id, project_id, tab_type, label, is_active, payload_json) =
            row.map_err(|error| format!("Failed to read workbench tab: {error}"))?;
        let parsed: Value = serde_json::from_str(&payload_json)
            .map_err(|error| format!("Failed to parse tab payload: {error}"))?;
        let payload = sanitize_payload(&tab_type, &parsed);
        if is_active != 0 {
            active_tab_id = Some(id.clone());
        }
        tabs.push(WorkbenchSessionTab {
            id,
            project_id,
            tab_type,
            label,
            payload,
        });
    }

    Ok(WorkbenchSession {
        tabs,
        right_sidebar_open: load_right_sidebar_open(conn)?,
        active_tab_id,
    })
}

fn load_right_sidebar_open(conn: &Connection) -> Result<Option<bool>, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM workbench_prefs WHERE key = ?1",
            [RIGHT_SIDEBAR_PREF_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read workbench prefs: {error}"))?;
    Ok(value.map(|raw| raw == "true" || raw == "1"))
}

pub fn replace_session(
    conn: &Connection,
    tabs: &[WorkbenchTabInput],
    active_tab_id: Option<&str>,
    right_sidebar_open: Option<bool>,
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start workbench transaction: {error}"))?;
    tx.execute("DELETE FROM workbench_tabs", [])
        .map_err(|error| format!("Failed to clear workbench tabs: {error}"))?;

    let updated_at = now_iso();
    for (index, tab) in tabs.iter().enumerate() {
        let is_active = active_tab_id == Some(tab.id.as_str());
        let payload = sanitize_payload(&tab.tab_type, &tab.payload);
        let payload_json = serde_json::to_string(&payload)
            .map_err(|error| format!("Failed to serialize tab payload: {error}"))?;
        tx.execute(
            "INSERT INTO workbench_tabs (
                id, project_id, type, label, sort_order, is_active, payload_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                tab.id,
                tab.project_id,
                tab.tab_type,
                tab.label,
                index as i64,
                if is_active { 1 } else { 0 },
                payload_json,
                updated_at,
            ],
        )
        .map_err(|error| format!("Failed to insert workbench tab: {error}"))?;
    }

    if let Some(open) = right_sidebar_open {
        tx.execute(
            "INSERT INTO workbench_prefs (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![RIGHT_SIDEBAR_PREF_KEY, if open { "true" } else { "false" }],
        )
        .map_err(|error| format!("Failed to save workbench prefs: {error}"))?;
    }

    tx.commit()
        .map_err(|error| format!("Failed to commit workbench session: {error}"))?;
    Ok(())
}

pub fn load_view_state(
    conn: &Connection,
    project_id: &str,
    path: &str,
) -> Result<Option<Value>, String> {
    let json: Option<String> = conn
        .query_row(
            "SELECT view_state_json FROM editor_view_state
             WHERE project_id = ?1 AND path = ?2",
            params![project_id, path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Failed to load editor view state: {error}"))?;
    match json {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse editor view state: {error}")),
        None => Ok(None),
    }
}

pub fn save_view_state(
    conn: &Connection,
    project_id: &str,
    path: &str,
    view_state: &Value,
) -> Result<(), String> {
    let json = serde_json::to_string(view_state)
        .map_err(|error| format!("Failed to serialize editor view state: {error}"))?;
    conn.execute(
        "INSERT INTO editor_view_state (project_id, path, view_state_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id, path) DO UPDATE SET
            view_state_json = excluded.view_state_json,
            updated_at = excluded.updated_at",
        params![project_id, path, json, now_iso()],
    )
    .map_err(|error| format!("Failed to save editor view state: {error}"))?;
    Ok(())
}
