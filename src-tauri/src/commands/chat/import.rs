use std::fs;
use std::path::Path;

use rusqlite::Connection;
use tauri::AppHandle;

use super::meta::ChatMeta;
use super::project_id::resolve_project_id_for_app;
use super::store;
use crate::commands::paths::user_vixl_dir;

const IMPORT_MARKER: &str = ".imported-to-sqlite";

pub fn import_jsonl_if_needed(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let chats_root = user_vixl_dir(app)?.join("chats");
    let marker = chats_root.join(IMPORT_MARKER);
    if marker.exists() || !chats_root.is_dir() {
        return Ok(());
    }

    import_chats_dir(app, conn, &chats_root)?;
    fs::write(&marker, "1").map_err(|e| format!("Failed to write chat import marker: {e}"))?;
    Ok(())
}

pub fn import_chats_dir(
    app: &AppHandle,
    conn: &Connection,
    chats_root: &Path,
) -> Result<(), String> {
    for slug_entry in fs::read_dir(chats_root).map_err(|e| e.to_string())? {
        let slug_entry = slug_entry.map_err(|e| e.to_string())?;
        if !slug_entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let slug = slug_entry.file_name().to_string_lossy().to_string();
        import_slug_dir(app, conn, &slug_entry.path(), &slug)?;
    }
    Ok(())
}

fn import_slug_dir(
    app: &AppHandle,
    conn: &Connection,
    slug_dir: &Path,
    slug: &str,
) -> Result<(), String> {
    for chat_entry in fs::read_dir(slug_dir).map_err(|e| e.to_string())? {
        let chat_entry = chat_entry.map_err(|e| e.to_string())?;
        if !chat_entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let meta_path = chat_entry.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        import_one_chat(app, conn, &chat_entry.path(), slug)?;
    }
    Ok(())
}

fn import_one_chat(
    app: &AppHandle,
    conn: &Connection,
    chat_dir: &Path,
    slug: &str,
) -> Result<(), String> {
    let content = fs::read_to_string(chat_dir.join("meta.json")).map_err(|e| e.to_string())?;
    let meta: ChatMeta = match serde_json::from_str(&content) {
        Ok(meta) => meta,
        Err(_) => return Ok(()),
    };
    if store::chat_exists(conn, &meta.id)? {
        return Ok(());
    }

    let project_id = resolve_project_id_for_app(app, slug, &meta.project_root);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    store::insert_chat(&tx, &meta, &project_id)?;
    import_messages(&tx, chat_dir, &meta.id)?;
    import_usage(&tx, chat_dir, &meta.id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn import_messages(conn: &Connection, chat_dir: &Path, chat_id: &str) -> Result<(), String> {
    let path = chat_dir.join("messages.jsonl");
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut seq = 0_i64;
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        store::insert_message_value(conn, chat_id, seq, &value)?;
        seq += 1;
    }
    Ok(())
}

fn import_usage(conn: &Connection, chat_dir: &Path, chat_id: &str) -> Result<(), String> {
    let path = chat_dir.join("usage-ledger.json");
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(());
    };
    let Some(records) = value.as_array() else {
        return Ok(());
    };
    for (seq, record) in records.iter().enumerate() {
        if record.is_object() {
            store::insert_usage_row(conn, chat_id, seq as i64, record)?;
        }
    }
    Ok(())
}
