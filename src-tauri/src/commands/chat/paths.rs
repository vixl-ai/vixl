use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use crate::commands::paths::user_vixl_dir;

pub(crate) fn chat_dir_path(
    app: &AppHandle,
    project_slug: &str,
    chat_id: &str,
) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?
        .join("chats")
        .join(project_slug)
        .join(chat_id))
}

pub(crate) fn chat_dir_for(
    app: &AppHandle,
    project_slug: &str,
    chat_id: &str,
) -> Result<PathBuf, String> {
    let dir = chat_dir_path(app, project_slug, chat_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
