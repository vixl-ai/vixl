use rusqlite::{params, Connection, OptionalExtension, Row};

use super::json::{column_opt_string, opt_json, parse_opt_json};
use crate::commands::chat::meta::{now_iso, ChatMeta, ChatRecord};

const CHAT_COLUMNS: &str = "
    id, project_id, project_slug, project_root, title, mode, model, status, attention,
    created_at, updated_at, forked_from, pinned, pinned_at, prefix_snapshot, active_context,
    awaiting_plan_go, subagent_model, reasoning, subagent_reasoning, usage_totals
";

pub fn insert_chat(conn: &Connection, meta: &ChatMeta, project_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chats (
            id, project_id, project_slug, project_root, title, mode, model, status, attention,
            created_at, updated_at, forked_from, pinned, pinned_at, prefix_snapshot, active_context,
            awaiting_plan_go, subagent_model, reasoning, subagent_reasoning, usage_totals
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![
            meta.id,
            project_id,
            meta.project_slug,
            meta.project_root,
            meta.title,
            meta.mode,
            meta.model,
            meta.status,
            meta.attention,
            meta.created_at,
            meta.updated_at,
            meta.forked_from,
            if meta.pinned { 1 } else { 0 },
            meta.pinned_at,
            opt_json(&meta.prefix_snapshot)?,
            opt_json(&meta.active_context)?,
            opt_json(&meta.awaiting_plan_go)?,
            meta.subagent_model,
            meta.reasoning,
            meta.subagent_reasoning,
            opt_json(&meta.usage_totals)?,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_chat(conn: &Connection, meta: &ChatMeta, project_id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE chats SET
                project_id = ?2,
                project_slug = ?3,
                project_root = ?4,
                title = ?5,
                mode = ?6,
                model = ?7,
                status = ?8,
                attention = ?9,
                created_at = ?10,
                updated_at = ?11,
                forked_from = ?12,
                pinned = ?13,
                pinned_at = ?14,
                prefix_snapshot = ?15,
                active_context = ?16,
                awaiting_plan_go = ?17,
                subagent_model = ?18,
                reasoning = ?19,
                subagent_reasoning = ?20,
                usage_totals = ?21
             WHERE id = ?1",
            params![
                meta.id,
                project_id,
                meta.project_slug,
                meta.project_root,
                meta.title,
                meta.mode,
                meta.model,
                meta.status,
                meta.attention,
                meta.created_at,
                meta.updated_at,
                meta.forked_from,
                if meta.pinned { 1 } else { 0 },
                meta.pinned_at,
                opt_json(&meta.prefix_snapshot)?,
                opt_json(&meta.active_context)?,
                opt_json(&meta.awaiting_plan_go)?,
                meta.subagent_model,
                meta.reasoning,
                meta.subagent_reasoning,
                opt_json(&meta.usage_totals)?,
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Chat not found".to_string());
    }
    Ok(())
}

pub fn get_chat(
    conn: &Connection,
    project_slug: &str,
    chat_id: &str,
) -> Result<ChatRecord, String> {
    let sql = format!("SELECT {CHAT_COLUMNS} FROM chats WHERE id = ?1 AND project_slug = ?2");
    conn.query_row(&sql, params![chat_id, project_slug], map_row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Chat not found".to_string())
        .and_then(row_to_record)
}

pub fn chat_exists(conn: &Connection, chat_id: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chats WHERE id = ?1",
            params![chat_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

pub fn list_chats_for_slug(conn: &Connection, project_slug: &str) -> Result<Vec<ChatMeta>, String> {
    let sql = format!(
        "SELECT {CHAT_COLUMNS} FROM chats WHERE project_slug = ?1
         ORDER BY pinned DESC, updated_at DESC"
    );
    query_metas(conn, &sql, params![project_slug])
}

pub fn list_pinned_chats(conn: &Connection) -> Result<Vec<ChatMeta>, String> {
    let sql = format!("SELECT {CHAT_COLUMNS} FROM chats WHERE pinned = 1 ORDER BY pinned_at DESC");
    query_metas(conn, &sql, params![])
}

pub fn delete_chat(conn: &Connection, project_slug: &str, chat_id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM chats WHERE id = ?1 AND project_slug = ?2",
            params![chat_id, project_slug],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Chat not found".to_string());
    }
    Ok(())
}

pub fn bump_updated_at(conn: &Connection, project_slug: &str, chat_id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE chats SET updated_at = ?3 WHERE id = ?1 AND project_slug = ?2",
            params![chat_id, project_slug, now_iso()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Chat not found".to_string());
    }
    Ok(())
}

fn query_metas(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<ChatMeta>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params, map_row).map_err(|e| e.to_string())?;
    let mut chats = Vec::new();
    for row in rows {
        chats.push(row_to_record(row.map_err(|e| e.to_string())?)?.meta);
    }
    Ok(chats)
}

struct MappedChat {
    id: String,
    project_id: String,
    project_slug: String,
    project_root: String,
    title: String,
    mode: String,
    model: String,
    status: String,
    attention: Option<String>,
    created_at: String,
    updated_at: String,
    forked_from: Option<String>,
    pinned: i64,
    pinned_at: Option<String>,
    prefix_snapshot: Option<String>,
    active_context: Option<String>,
    awaiting_plan_go: Option<String>,
    subagent_model: Option<String>,
    reasoning: Option<String>,
    subagent_reasoning: Option<String>,
    usage_totals: Option<String>,
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<MappedChat> {
    Ok(MappedChat {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_slug: row.get(2)?,
        project_root: row.get(3)?,
        title: row.get(4)?,
        mode: row.get(5)?,
        model: row.get(6)?,
        status: row.get(7)?,
        attention: column_opt_string(row.get_ref(8)?)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        forked_from: column_opt_string(row.get_ref(11)?)?,
        pinned: row.get(12)?,
        pinned_at: column_opt_string(row.get_ref(13)?)?,
        prefix_snapshot: column_opt_string(row.get_ref(14)?)?,
        active_context: column_opt_string(row.get_ref(15)?)?,
        awaiting_plan_go: column_opt_string(row.get_ref(16)?)?,
        subagent_model: column_opt_string(row.get_ref(17)?)?,
        reasoning: column_opt_string(row.get_ref(18)?)?,
        subagent_reasoning: column_opt_string(row.get_ref(19)?)?,
        usage_totals: column_opt_string(row.get_ref(20)?)?,
    })
}

fn row_to_record(row: MappedChat) -> Result<ChatRecord, String> {
    Ok(ChatRecord {
        project_id: row.project_id,
        meta: ChatMeta {
            id: row.id,
            title: row.title,
            project_slug: row.project_slug,
            project_root: row.project_root,
            mode: row.mode,
            model: row.model,
            status: row.status,
            attention: row.attention,
            created_at: row.created_at,
            updated_at: row.updated_at,
            forked_from: row.forked_from,
            pinned: row.pinned != 0,
            pinned_at: row.pinned_at,
            prefix_snapshot: parse_opt_json(row.prefix_snapshot)?,
            active_context: parse_opt_json(row.active_context)?,
            awaiting_plan_go: parse_opt_json(row.awaiting_plan_go)?,
            subagent_model: row.subagent_model,
            reasoning: row.reasoning,
            subagent_reasoning: row.subagent_reasoning,
            usage_totals: parse_opt_json(row.usage_totals)?,
        },
    })
}
