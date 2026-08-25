use rusqlite::{params, Connection};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::json::{parse_json_text, value_to_json_text};
use crate::commands::chat::meta::now_iso;

pub fn next_seq(conn: &Connection, chat_id: &str) -> Result<i64, String> {
    let max: Option<i64> = conn
        .query_row(
            "SELECT MAX(seq) FROM chat_messages WHERE chat_id = ?1",
            params![chat_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(max.unwrap_or(-1) + 1)
}

pub fn insert_message_value(
    conn: &Connection,
    chat_id: &str,
    seq: i64,
    line: &Value,
) -> Result<(), String> {
    let parsed = ParsedMessage::from_value(line)?;
    conn.execute(
        "INSERT INTO chat_messages (
            id, chat_id, seq, role, parts_json, created_at, model,
            mention_highlights_json, harness_event_json, extras_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            parsed.id,
            chat_id,
            seq,
            parsed.role,
            parsed.parts_json,
            parsed.created_at,
            parsed.model,
            parsed.mention_highlights_json,
            parsed.harness_event_json,
            parsed.extras_json,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_messages(conn: &Connection, chat_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, role, parts_json, created_at, model, mention_highlights_json,
                    harness_event_json, extras_json
             FROM chat_messages WHERE chat_id = ?1 ORDER BY seq ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chat_id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                parts_json: row.get(2)?,
                created_at: row.get(3)?,
                model: row.get(4)?,
                mention_highlights_json: row.get(5)?,
                harness_event_json: row.get(6)?,
                extras_json: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?.to_value()?);
    }
    Ok(messages)
}

pub fn delete_from_seq(conn: &Connection, chat_id: &str, from_seq: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chat_messages WHERE chat_id = ?1 AND seq >= ?2",
        params![chat_id, from_seq],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn copy_messages(
    conn: &Connection,
    source_chat_id: &str,
    dest_chat_id: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chat_messages (
            id, chat_id, seq, role, parts_json, created_at, model,
            mention_highlights_json, harness_event_json, extras_json
        )
        SELECT id, ?2, seq, role, parts_json, created_at, model,
               mention_highlights_json, harness_event_json, extras_json
        FROM chat_messages WHERE chat_id = ?1",
        params![source_chat_id, dest_chat_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

struct ParsedMessage {
    id: String,
    role: String,
    parts_json: String,
    created_at: String,
    model: Option<String>,
    mention_highlights_json: Option<String>,
    harness_event_json: Option<String>,
    extras_json: Option<String>,
}

impl ParsedMessage {
    fn from_value(line: &Value) -> Result<Self, String> {
        let mut obj = match line {
            Value::Object(map) => map.clone(),
            _ => return Err("Chat line must be a JSON object".to_string()),
        };

        let id = take_string(&mut obj, "id").unwrap_or_else(|| Uuid::new_v4().to_string());
        let role = take_string(&mut obj, "role").unwrap_or_default();
        let created_at = take_string(&mut obj, "createdAt").unwrap_or_else(now_iso);
        let model = take_string(&mut obj, "model");
        let parts = obj.remove("parts").unwrap_or(Value::Null);
        let mention_highlights = obj.remove("mentionHighlights");
        let harness_event = obj.remove("harnessEvent");
        let extras_json = if obj.is_empty() {
            None
        } else {
            Some(value_to_json_text(&Value::Object(obj))?)
        };

        Ok(Self {
            id,
            role,
            parts_json: value_to_json_text(&parts)?,
            created_at,
            model,
            mention_highlights_json: opt_value_text(mention_highlights)?,
            harness_event_json: opt_value_text(harness_event)?,
            extras_json,
        })
    }
}

struct MessageRow {
    id: String,
    role: String,
    parts_json: String,
    created_at: String,
    model: Option<String>,
    mention_highlights_json: Option<String>,
    harness_event_json: Option<String>,
    extras_json: Option<String>,
}

impl MessageRow {
    fn to_value(&self) -> Result<Value, String> {
        let mut map = Map::new();
        if let Some(extras) = &self.extras_json {
            if let Value::Object(extra_map) = parse_json_text(extras)? {
                map = extra_map;
            }
        }
        map.insert("id".to_string(), Value::String(self.id.clone()));
        map.insert("role".to_string(), Value::String(self.role.clone()));
        map.insert("parts".to_string(), parse_json_text(&self.parts_json)?);
        map.insert(
            "createdAt".to_string(),
            Value::String(self.created_at.clone()),
        );
        if let Some(model) = &self.model {
            map.insert("model".to_string(), Value::String(model.clone()));
        }
        if let Some(highlights) = &self.mention_highlights_json {
            map.insert(
                "mentionHighlights".to_string(),
                parse_json_text(highlights)?,
            );
        }
        if let Some(event) = &self.harness_event_json {
            map.insert("harnessEvent".to_string(), parse_json_text(event)?);
        }
        Ok(Value::Object(map))
    }
}

fn take_string(obj: &mut Map<String, Value>, key: &str) -> Option<String> {
    match obj.remove(key) {
        Some(Value::String(value)) => Some(value),
        Some(other) => other.as_str().map(str::to_string),
        None => None,
    }
}

fn opt_value_text(value: Option<Value>) -> Result<Option<String>, String> {
    match value {
        Some(Value::Null) | None => Ok(None),
        Some(json) => value_to_json_text(&json).map(Some),
    }
}
