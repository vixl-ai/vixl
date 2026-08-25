use tauri::{AppHandle, State};
use uuid::Uuid;

use super::meta::{now_iso, ChatMeta};
use super::paths::chat_dir_for;
use super::project_id::resolve_project_id_for_app;
use super::store;
use crate::db::AppDb;

#[tauri::command]
pub fn create_chat(
    app: AppHandle,
    db: State<AppDb>,
    project_slug: String,
    project_root: String,
    mode: String,
    model: String,
    title: Option<String>,
) -> Result<ChatMeta, String> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let project_id = resolve_project_id_for_app(&app, &project_slug, &project_root);
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

    chat_dir_for(&app, &project_slug, &id)?;
    let conn = db.lock()?;
    store::insert_chat(&conn, &meta, &project_id)?;
    Ok(meta)
}
