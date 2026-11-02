use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use super::copy_active_plan::copy_active_plan_to_root;
use super::meta::{now_iso, ChatMeta};
use super::paths::chat_dir_path;
use super::rewrite_checkpoints::rewrite_file_checkpoints_for_root;
use super::store;
use crate::commands::fs::{canonical_project_root, ensure_ssh_project_directory_await};
use crate::commands::registry::{
    add_or_update_project, registry_set_active_project, roots_match, FleetProject,
};
use crate::commands::ssh::{is_ssh_root, parse_root, ssh_uri_for};
use crate::db::AppDb;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveChatToWorkspaceResult {
    pub project: FleetProjectView,
    pub chat: ChatMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetProjectView {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub root_path: String,
    pub last_opened: String,
}

impl From<FleetProject> for FleetProjectView {
    fn from(project: FleetProject) -> Self {
        Self {
            id: project.id,
            name: project.name,
            slug: project.slug,
            root_path: project.root_path,
            last_opened: project.last_opened,
        }
    }
}

pub(crate) fn resolve_destination_root(
    root_path: &str,
    current_root: &str,
) -> Result<String, String> {
    resolve_local_destination(root_path, current_root)
}

async fn resolve_destination_root_command(
    root_path: &str,
    current_root: &str,
) -> Result<String, String> {
    if is_ssh_root(root_path) {
        let uri = prepare_ssh_destination(root_path, current_root)?;
        ensure_ssh_project_directory_await(&uri).await?;
        return Ok(uri);
    }
    let root_path = root_path.to_string();
    let current_root = current_root.to_string();
    tokio::task::spawn_blocking(move || resolve_local_destination(&root_path, &current_root))
        .await
        .map_err(|error| error.to_string())?
}

fn resolve_local_destination(root_path: &str, current_root: &str) -> Result<String, String> {
    let canonical = canonical_project_root(root_path)?;
    if same_project_root(current_root, &canonical) {
        return Err("Destination is the chat's current project root".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

pub(crate) fn prepare_ssh_destination(
    root_path: &str,
    current_root: &str,
) -> Result<String, String> {
    let parsed = parse_root(root_path)?;
    let uri = ssh_uri_for(&parsed, &parsed.remote_path);
    if roots_match(current_root, &uri) {
        return Err("Destination is the chat's current project root".to_string());
    }
    Ok(uri)
}

fn same_project_root(current_root: &str, dest: &Path) -> bool {
    if Path::new(current_root) == dest {
        return true;
    }
    Path::new(current_root)
        .canonicalize()
        .ok()
        .is_some_and(|current| current == dest)
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("project")
        .to_string()
}

fn rename_chat_directory(
    app: &AppHandle,
    from_slug: &str,
    to_slug: &str,
    chat_id: &str,
) -> Result<PathBuf, String> {
    let dest = chat_dir_path(app, to_slug, chat_id)?;
    if from_slug == to_slug {
        if !dest.exists() {
            fs::create_dir_all(&dest).map_err(|error| error.to_string())?;
        }
        return Ok(dest);
    }

    if dest.exists() {
        return Err(format!(
            "Destination chat directory already exists: {}",
            dest.display()
        ));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let src = chat_dir_path(app, from_slug, chat_id)?;
    if src.exists() {
        fs::rename(&src, &dest).map_err(|error| error.to_string())?;
    } else {
        fs::create_dir_all(&dest).map_err(|error| error.to_string())?;
    }
    Ok(dest)
}

fn rollback_chat_directory(
    app: &AppHandle,
    from_slug: &str,
    to_slug: &str,
    chat_id: &str,
) -> Result<(), String> {
    let src = chat_dir_path(app, from_slug, chat_id)?;
    let dest = chat_dir_path(app, to_slug, chat_id)?;
    if src.exists() && !dest.exists() {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(src, dest).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_chat_to_workspace(
    app: AppHandle,
    db: State<'_, AppDb>,
    from_project_slug: String,
    chat_id: String,
    root_path: String,
) -> Result<MoveChatToWorkspaceResult, String> {
    let record = {
        let conn = db.lock()?;
        store::get_chat(&conn, &from_project_slug, &chat_id)?
    };
    let old_root = record.meta.project_root.clone();
    let dest_root_str = resolve_destination_root_command(&root_path, &old_root).await?;
    let project =
        add_or_update_project(&app, folder_name(Path::new(&dest_root_str)), dest_root_str)?;
    registry_set_active_project(app.clone(), Some(project.id.clone()))?;

    let dest_dir = rename_chat_directory(&app, &from_project_slug, &project.slug, &chat_id)?;

    let mut meta = record.meta;
    meta.project_slug = project.slug.clone();
    meta.project_root = project.root_path.clone();
    meta.updated_at = now_iso();

    {
        let conn = db.lock()?;
        if let Err(error) = store::update_chat(&conn, &meta, &project.id) {
            if from_project_slug != project.slug {
                if let Err(rollback_error) =
                    rollback_chat_directory(&app, &project.slug, &from_project_slug, &chat_id)
                {
                    log::warn!("Failed to roll back chat directory after move: {rollback_error}");
                }
            }
            return Err(error);
        }
    }

    if let Err(error) = rewrite_file_checkpoints_for_root(&dest_dir, &old_root, &project.root_path)
    {
        log::warn!("Failed to rewrite file checkpoints after workspace move: {error}");
    }

    if let Some(plan_path) = meta.active_plan_path.as_deref() {
        if let Err(error) = copy_active_plan_to_root(&old_root, &project.root_path, plan_path) {
            log::warn!("Failed to copy active plan after workspace move: {error}");
        }
    }

    Ok(MoveChatToWorkspaceResult {
        project: FleetProjectView::from(project),
        chat: meta,
    })
}

#[cfg(test)]
mod tests {
    use super::{prepare_ssh_destination, resolve_destination_root};
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("vixl-move-root-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("temp move root");
            Self { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn reject_missing_dir() {
        let missing = std::env::temp_dir().join(format!("vixl-missing-{}", Uuid::new_v4()));
        let error = resolve_destination_root(missing.to_str().expect("utf-8"), "/tmp/other")
            .expect_err("missing dir");
        assert!(error.contains("Invalid project root") || error.contains("not a directory"));
    }

    #[test]
    fn reject_same_root() {
        let root = TempRoot::new();
        let root_str = root.path.to_string_lossy().to_string();
        let error = resolve_destination_root(&root_str, &root_str).expect_err("same root");
        assert!(error.contains("current project root"));
    }

    #[test]
    fn reject_file_as_root() {
        let root = TempRoot::new();
        let file = root.path.join("not-a-dir.txt");
        fs::write(&file, b"nope").expect("write file");
        let error = resolve_destination_root(file.to_str().expect("utf-8"), "/tmp/other")
            .expect_err("file is not a dir");
        assert!(error.contains("not a directory") || error.contains("Invalid project root"));
    }

    #[test]
    fn reject_same_ssh_root_without_connecting() {
        let root = "ssh://aidanhibbard@eva.local/home/aidanhibbard/proj";
        let error = prepare_ssh_destination(root, root).expect_err("same ssh root");
        assert!(error.contains("current project root"));
    }

    #[test]
    fn prepare_ssh_destination_keeps_the_remote_folder() {
        let current = "ssh://aidanhibbard@eva.local/home/aidanhibbard";
        let dest = "ssh://aidanhibbard@eva.local/home/aidanhibbard/src/llama.cpp";
        assert_eq!(prepare_ssh_destination(dest, current).expect("dest"), dest);
    }

    #[test]
    fn reject_opening_remote_root() {
        let error = prepare_ssh_destination(
            "ssh://aidanhibbard@eva.local/",
            "ssh://aidanhibbard@eva.local/home/aidanhibbard",
        )
        .expect_err("slash");
        assert!(error.contains("Opening / on eva.local is refused."));
    }
}
