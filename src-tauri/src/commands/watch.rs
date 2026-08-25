use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use super::paths::{resolve_project_vixl_dir, user_vixl_dir};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VixlFileChange {
    pub scope: String,
    pub root_path: Option<String>,
    pub kind: String,
}

pub struct WatchState {
    inner: Mutex<Option<RecommendedWatcher>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn classify_change(
    path: &Path,
    personal_dir: &Path,
    project_dir: Option<&Path>,
    project_root: Option<&str>,
) -> Option<VixlFileChange> {
    let in_personal = path.starts_with(personal_dir);
    let in_project = project_dir.is_some_and(|dir| path.starts_with(dir));

    if !in_personal && !in_project {
        return None;
    }

    let file_name = path.file_name().and_then(|name| name.to_str())?;

    let scope = if in_project && !in_personal {
        "project"
    } else if in_personal {
        "personal"
    } else {
        "project"
    };

    let root_path = if scope == "project" {
        project_root.map(String::from)
    } else {
        None
    };

    let kind = if file_name == "settings.json" {
        "settings"
    } else if file_name == "mcp.json" {
        "mcp"
    } else if has_path_segment(path, "plans") {
        "plans"
    } else if has_path_segment(path, "studio") {
        "studio"
    } else if has_path_segment(path, "skills") {
        "skills"
    } else if has_path_segment(path, "agents") {
        "agents"
    } else if has_path_segment(path, "rules") {
        "rules"
    } else {
        return None;
    };

    Some(VixlFileChange {
        scope: scope.to_string(),
        root_path,
        kind: kind.to_string(),
    })
}

fn has_path_segment(path: &Path, segment: &str) -> bool {
    path.components()
        .any(|component| component.as_os_str() == segment)
}

#[tauri::command]
pub fn watch_vixl_paths(app: AppHandle, project_root: Option<String>) -> Result<(), String> {
    let personal_dir = user_vixl_dir(&app)?;
    let project_dir = project_root
        .as_ref()
        .map(|root| resolve_project_vixl_dir(root));

    let state = app.state::<WatchState>();
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = None;

    let personal_dir_for_handler = personal_dir.clone();
    let project_dir_for_handler = project_dir.clone();
    let project_root_for_handler = project_root.clone();
    let app_handle = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let Ok(event) = result else {
                return;
            };

            match event.kind {
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
                _ => return,
            }

            let mut latest_change: Option<VixlFileChange> = None;

            for path in event.paths {
                if let Some(change) = classify_change(
                    &path,
                    &personal_dir_for_handler,
                    project_dir_for_handler.as_deref(),
                    project_root_for_handler.as_deref(),
                ) {
                    latest_change = Some(change);
                }
            }

            let Some(change) = latest_change else {
                return;
            };

            let emit_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(350)).await;
                let _ = emit_app.emit("vixl-file-changed", change);
            });
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&personal_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    if let Some(dir) = project_dir {
        if dir.exists() {
            watcher
                .watch(&dir, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }

    *guard = Some(watcher);
    Ok(())
}
