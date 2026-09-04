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
    } else if file_name == "AGENTS.md" || file_name == "agents.md" {
        "agents-md"
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn personal_dir() -> PathBuf {
        PathBuf::from("/home/user/.vixl")
    }

    fn project_vixl_dir() -> PathBuf {
        PathBuf::from("/repo/.vixl")
    }

    fn classify_project(relative: &str) -> Option<VixlFileChange> {
        let project_dir = project_vixl_dir();
        classify_change(
            &project_dir.join(relative),
            &personal_dir(),
            Some(&project_dir),
            Some("/repo"),
        )
    }

    fn classify_personal(relative: &str) -> Option<VixlFileChange> {
        let personal = personal_dir();
        classify_change(
            &personal.join(relative),
            &personal,
            Some(&project_vixl_dir()),
            Some("/repo"),
        )
    }

    #[test]
    fn classifies_uppercase_agents_md() {
        let change = classify_project("AGENTS.md").expect("classified");
        assert_eq!(change.kind, "agents-md");
        assert_eq!(change.scope, "project");
        assert_eq!(change.root_path.as_deref(), Some("/repo"));
    }

    #[test]
    fn classifies_lowercase_agents_md() {
        let change = classify_project("agents.md").expect("classified");
        assert_eq!(change.kind, "agents-md");
        assert_eq!(change.scope, "project");
    }

    #[test]
    fn classifies_personal_agents_md() {
        let change = classify_personal("AGENTS.md").expect("classified");
        assert_eq!(change.kind, "agents-md");
        assert_eq!(change.scope, "personal");
        assert!(change.root_path.is_none());
    }

    #[test]
    fn classifies_subagent_file_as_agents() {
        let change = classify_project("agents/foo.md").expect("classified");
        assert_eq!(change.kind, "agents");
        assert_eq!(change.scope, "project");
    }

    #[test]
    fn classifies_rule_file_as_rules() {
        let change = classify_project("rules/x.md").expect("classified");
        assert_eq!(change.kind, "rules");
        assert_eq!(change.scope, "project");
    }

    #[test]
    fn ignores_paths_outside_watched_vixl_dirs() {
        let change = classify_change(
            Path::new("/other/AGENTS.md"),
            &personal_dir(),
            Some(&project_vixl_dir()),
            Some("/repo"),
        );
        assert!(change.is_none());
    }
}
