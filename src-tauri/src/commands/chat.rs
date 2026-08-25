use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use super::paths::user_vixl_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    pub project_slug: String,
    pub project_root: String,
    pub mode: String,
    pub model: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub forked_from: Option<String>,
    pub pinned: bool,
    pub pinned_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix_snapshot: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_context: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting_plan_go: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_totals: Option<serde_json::Value>,
}

fn chats_dir(app: &AppHandle, project_slug: &str) -> Result<PathBuf, String> {
    let base = user_vixl_dir(app)?;
    let dir = base.join("chats").join(project_slug);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn chat_dir_for(
    app: &AppHandle,
    project_slug: &str,
    chat_id: &str,
) -> Result<PathBuf, String> {
    let dir = chats_dir(app, project_slug)?.join(chat_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn chat_dir(app: &AppHandle, project_slug: &str, chat_id: &str) -> Result<PathBuf, String> {
    chat_dir_for(app, project_slug, chat_id)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn create_chat(
    app: AppHandle,
    project_slug: String,
    project_root: String,
    mode: String,
    model: String,
    title: Option<String>,
) -> Result<ChatMeta, String> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let meta = ChatMeta {
        id: id.clone(),
        title: title.unwrap_or_else(|| "New Agent".to_string()),
        project_slug: project_slug.clone(),
        project_root,
        mode,
        model,
        status: "idle".to_string(),
        attention: None,
        created_at: now.clone(),
        updated_at: now,
        forked_from: None,
        pinned: false,
        pinned_at: None,
        prefix_snapshot: None,
        active_context: None,
        awaiting_plan_go: None,
        subagent_model: None,
        reasoning: None,
        subagent_reasoning: None,
        usage_totals: None,
    };

    let dir = chat_dir(&app, &project_slug, &id)?;
    let meta_path = dir.join("meta.json");
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(&meta_path, json).map_err(|e| e.to_string())?;
    fs::write(dir.join("messages.jsonl"), "").map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command]
pub fn list_chats(app: AppHandle, project_slug: String) -> Result<Vec<ChatMeta>, String> {
    let dir = chats_dir(&app, &project_slug)?;
    let mut chats = Vec::new();
    if !dir.exists() {
        return Ok(chats);
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let meta_path = entry.path().join("meta.json");
        if !meta_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        if let Ok(meta) = serde_json::from_str::<ChatMeta>(&content) {
            chats.push(meta);
        }
    }
    chats.sort_by(|a, b| match (a.pinned, b.pinned) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b.updated_at.cmp(&a.updated_at),
    });
    Ok(chats)
}

#[tauri::command]
pub fn read_chat_meta(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
) -> Result<ChatMeta, String> {
    let meta_path = chat_dir(&app, &project_slug, &chat_id)?.join("meta.json");
    let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_chat_messages(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let path = chat_dir(&app, &project_slug, &chat_id)?.join("messages.jsonl");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            lines.push(value);
        }
    }
    Ok(lines)
}

#[tauri::command]
pub fn truncate_chat_log(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
    before_message_id: Option<String>,
    keep_through_last_user: Option<bool>,
    keep_through_message_id: Option<String>,
) -> Result<(), String> {
    let messages = read_chat_messages(app.clone(), project_slug.clone(), chat_id.clone())?;
    let keep_count = if let Some(message_id) = before_message_id {
        messages
            .iter()
            .position(|line| {
                line.get("id")
                    .and_then(|value| value.as_str())
                    .is_some_and(|id| id == message_id)
            })
            .unwrap_or(messages.len())
    } else if let Some(message_id) = keep_through_message_id {
        messages
            .iter()
            .position(|line| {
                line.get("id")
                    .and_then(|value| value.as_str())
                    .is_some_and(|id| id == message_id)
            })
            .map(|index| index + 1)
            .unwrap_or(0)
    } else if keep_through_last_user.unwrap_or(false) {
        messages
            .iter()
            .rposition(|line| {
                line.get("role")
                    .and_then(|value| value.as_str())
                    .is_some_and(|role| role == "user")
            })
            .map(|index| index + 1)
            .unwrap_or(0)
    } else {
        return Err(
      "truncate_chat_log requires before_message_id, keep_through_message_id, or keep_through_last_user"
        .to_string(),
    );
    };

    let kept = messages.into_iter().take(keep_count).collect::<Vec<_>>();
    let path = chat_dir(&app, &project_slug, &chat_id)?.join("messages.jsonl");
    let mut content = String::new();
    for line in kept {
        let serialized = serde_json::to_string(&line).map_err(|e| e.to_string())?;
        content.push_str(&serialized);
        content.push('\n');
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let _ = update_chat_meta(app, project_slug, chat_id, serde_json::json!({}));
    Ok(())
}

#[tauri::command]
pub fn append_chat_line(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
    line: serde_json::Value,
) -> Result<(), String> {
    let path = chat_dir(&app, &project_slug, &chat_id)?.join("messages.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let serialized = serde_json::to_string(&line).map_err(|e| e.to_string())?;
    writeln!(file, "{serialized}").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_chat_meta(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
    patch: serde_json::Value,
) -> Result<ChatMeta, String> {
    let meta_path = chat_dir(&app, &project_slug, &chat_id)?.join("meta.json");
    let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let mut meta: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if let Some(obj) = patch.as_object() {
        for (key, value) in obj {
            meta[key] = value.clone();
        }
    }
    meta["updatedAt"] = serde_json::Value::String(now_iso());
    let updated: ChatMeta = serde_json::from_value(meta.clone()).map_err(|e| e.to_string())?;
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(updated)
}

#[tauri::command]
pub fn delete_chat(app: AppHandle, project_slug: String, chat_id: String) -> Result<(), String> {
    let dir = chat_dir(&app, &project_slug, &chat_id)?;
    fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fork_chat(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
) -> Result<ChatMeta, String> {
    let source_id = chat_id.clone();
    let source = read_chat_meta(app.clone(), project_slug.clone(), chat_id)?;
    let new_meta = create_chat(
        app.clone(),
        project_slug.clone(),
        source.project_root,
        source.mode,
        source.model,
        Some(format!("{} (fork)", source.title)),
    )?;
    let messages = read_chat_messages(app.clone(), project_slug.clone(), source_id.clone())?;
    for line in messages {
        append_chat_line(app.clone(), project_slug.clone(), new_meta.id.clone(), line)?;
    }
    if let Err(error) =
        super::file_checkpoint::copy_file_checkpoints(&app, &project_slug, &source_id, &new_meta.id)
    {
        log::warn!("Failed to copy file checkpoints on fork: {error}");
    }
    update_chat_meta(
        app,
        project_slug,
        new_meta.id.clone(),
        serde_json::json!({ "forkedFrom": source_id }),
    )
}

#[tauri::command]
pub fn pin_chat(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
    pinned: bool,
) -> Result<ChatMeta, String> {
    update_chat_meta(
        app,
        project_slug,
        chat_id,
        serde_json::json!({
          "pinned": pinned,
          "pinnedAt": if pinned { Some(now_iso()) } else { None::<String> }
        }),
    )
}

#[tauri::command]
pub fn list_pinned_chats(app: AppHandle) -> Result<Vec<ChatMeta>, String> {
    let base = user_vixl_dir(&app)?.join("chats");
    let mut pinned = Vec::new();
    if !base.exists() {
        return Ok(pinned);
    }
    for project_entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let project_entry = project_entry.map_err(|e| e.to_string())?;
        if !project_entry
            .file_type()
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            continue;
        }
        let slug = project_entry.file_name().to_string_lossy().to_string();
        for chat in list_chats(app.clone(), slug)? {
            if chat.pinned {
                pinned.push(chat);
            }
        }
    }
    pinned.sort_by(|a, b| b.pinned_at.as_ref().cmp(&a.pinned_at.as_ref()));
    Ok(pinned)
}
