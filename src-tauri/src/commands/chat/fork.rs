use tauri::{AppHandle, State};
use uuid::Uuid;

use super::meta::{now_iso, ChatMeta};
use super::paths::chat_dir_for;
use super::store;
use crate::db::AppDb;

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
    let new_meta = ChatMeta {
        id: new_id.clone(),
        title: format!("{} (fork)", source.meta.title),
        project_slug: project_slug.clone(),
        project_root: source.meta.project_root.clone(),
        mode: source.meta.mode.clone(),
        model: source.meta.model.clone(),
        status: "idle".to_string(),
        attention: None,
        created_at: now.clone(),
        updated_at: now,
        forked_from: Some(source_id.clone()),
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
