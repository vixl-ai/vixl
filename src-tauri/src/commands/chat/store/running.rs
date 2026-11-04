use rusqlite::{params, Connection};

pub(crate) const RUNNING_CHAT_LIMIT: i64 = 8;

pub struct RunningChatRow {
    pub id: String,
    pub project_slug: String,
    pub project_root: String,
    pub title: String,
    pub active_plan_path: Option<String>,
}

pub fn list_running_chats(conn: &Connection) -> Result<Vec<RunningChatRow>, String> {
    let sql = format!(
        "SELECT id, project_slug, project_root, title, active_plan_path
         FROM chats
         WHERE status = 'running'
         ORDER BY updated_at DESC
         LIMIT {RUNNING_CHAT_LIMIT}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![], map_running_row)
        .map_err(|e| e.to_string())?;
    let mut chats = Vec::new();
    for row in rows {
        chats.push(row.map_err(|e| e.to_string())?);
    }
    Ok(chats)
}

pub fn count_running_chats(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM chats WHERE status = 'running'",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn recent_harness_event_json(
    conn: &Connection,
    chat_id: &str,
    limit: i64,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT harness_event_json
             FROM chat_messages
             WHERE chat_id = ?1 AND harness_event_json IS NOT NULL
             ORDER BY seq DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chat_id, limit], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}

fn map_running_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunningChatRow> {
    Ok(RunningChatRow {
        id: row.get(0)?,
        project_slug: row.get(1)?,
        project_root: row.get(2)?,
        title: row.get(3)?,
        active_plan_path: row.get(4)?,
    })
}
