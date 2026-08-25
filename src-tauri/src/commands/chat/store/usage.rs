use rusqlite::{params, Connection};
use serde_json::Value;
use uuid::Uuid;

use super::json::value_to_json_text;

pub fn list_usage(conn: &Connection, chat_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT record_json FROM chat_usage_rows WHERE chat_id = ?1 ORDER BY seq ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chat_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        let text = row.map_err(|e| e.to_string())?;
        records.push(serde_json::from_str(&text).map_err(|e| e.to_string())?);
    }
    Ok(records)
}

pub fn replace_usage(conn: &Connection, chat_id: &str, records: &[Value]) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chat_usage_rows WHERE chat_id = ?1",
        params![chat_id],
    )
    .map_err(|e| e.to_string())?;
    for (seq, record) in records.iter().enumerate() {
        insert_usage_row(conn, chat_id, seq as i64, record)?;
    }
    Ok(())
}

pub fn insert_usage_row(
    conn: &Connection,
    chat_id: &str,
    seq: i64,
    record: &Value,
) -> Result<(), String> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let at = record.get("at").and_then(Value::as_str);
    conn.execute(
        "INSERT INTO chat_usage_rows (id, chat_id, seq, record_json, at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, chat_id, seq, value_to_json_text(record)?, at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
