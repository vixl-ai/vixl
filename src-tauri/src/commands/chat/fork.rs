use tauri::{AppHandle, State};
use uuid::Uuid;

use super::meta::{now_iso, ChatMeta};
use super::paths::chat_dir_for;
use super::store;
use crate::db::AppDb;

pub(super) fn forked_chat_meta(
    source: &ChatMeta,
    new_id: String,
    project_slug: String,
    now: String,
    source_id: String,
) -> ChatMeta {
    ChatMeta {
        id: new_id,
        title: format!("{} (fork)", source.title),
        project_slug,
        project_root: source.project_root.clone(),
        mode: source.mode.clone(),
        model: source.model.clone(),
        status: "idle".to_string(),
        attention: None,
        created_at: now.clone(),
        updated_at: now,
        last_user_message_at: None,
        forked_from: Some(source_id),
        pinned: false,
        pinned_at: None,
        prefix_snapshot: None,
        active_context: None,
        awaiting_plan_go: None,
        active_plan_path: None,
        subagent_model: None,
        reasoning: None,
        subagent_reasoning: None,
        permission_level: source.permission_level.clone(),
        usage_totals: None,
    }
}

#[tauri::command]
pub fn fork_chat(
    app: AppHandle,
    db: State<AppDb>,
    project_slug: String,
    chat_id: String,
) -> Result<ChatMeta, String> {
    let source_id = chat_id.clone();
    let now = now_iso();
    let new_id = Uuid::new_v4().to_string();

    let conn = db.lock()?;
    let source = store::get_chat(&conn, &project_slug, &source_id)?;
    let new_meta = forked_chat_meta(
        &source.meta,
        new_id.clone(),
        project_slug.clone(),
        now,
        source_id.clone(),
    );

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    store::insert_chat(&tx, &new_meta, &source.project_id)?;
    store::copy_messages(&tx, &source_id, &new_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    chat_dir_for(&app, &project_slug, &new_id)?;
    if let Err(error) = crate::commands::file_checkpoint::copy_file_checkpoints(
        &app,
        &project_slug,
        &source_id,
        &new_id,
    ) {
        log::warn!("Failed to copy file checkpoints on fork: {error}");
    }
    Ok(new_meta)
}
