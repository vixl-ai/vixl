use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use super::git_binary::git_binary;
use super::ssh::is_ssh_root;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHeadChanged {
    pub root_path: String,
}

pub struct GitHeadWatchState {
    inner: Mutex<Option<RecommendedWatcher>>,
}

impl GitHeadWatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn classify_head_change(path: &Path, git_dir: &Path) -> bool {
    path.strip_prefix(git_dir)
        .is_ok_and(|relative| relative == Path::new("HEAD"))
}

fn resolve_git_dir(root_path: &str) -> Option<PathBuf> {
    let git = git_binary().ok()?;
    let output = Command::new(&git)
        .arg("-C")
        .arg(root_path)
        .args(["rev-parse", "--absolute-git-dir"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }

    Some(PathBuf::from(path))
}

#[tauri::command]
pub fn watch_git_head(app: AppHandle, root_path: Option<String>) -> Result<(), String> {
    let state = app.state::<GitHeadWatchState>();
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = None;

    let Some(root) = root_path.filter(|path| !path.trim().is_empty()) else {
        return Ok(());
    };

    if is_ssh_root(&root) {
        return Ok(());
    }

    let Some(git_dir) = resolve_git_dir(&root) else {
        return Ok(());
    };

    if !git_dir.exists() {
        return Ok(());
    }

    let git_dir_for_handler = git_dir.clone();
    let root_for_handler = root.clone();
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

            let saw_head = event
                .paths
                .iter()
                .any(|path| classify_head_change(path, &git_dir_for_handler));
            if !saw_head {
                return;
            }

            let change = GitHeadChanged {
                root_path: root_for_handler.clone(),
            };
            let emit_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(350)).await;
                let _ = emit_app.emit("git-head-changed", change);
            });
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    // Non-recursive: objects and pack files live under git_dir and would spam.
    watcher
        .watch(&git_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn git_dir() -> PathBuf {
        PathBuf::from("/repo/.git")
    }

    fn classify(relative: &str) -> bool {
        classify_head_change(&git_dir().join(relative), &git_dir())
    }

    #[test]
    fn classifies_git_head() {
        assert!(classify("HEAD"));
    }

    #[test]
    fn ignores_git_index() {
        assert!(!classify("index"));
    }

    #[test]
    fn ignores_git_objects() {
        assert!(!classify("objects/pack/pack-abc.pack"));
    }

    #[test]
    fn ignores_head_lock() {
        assert!(!classify("HEAD.lock"));
    }

    #[test]
    fn ignores_logs_head() {
        assert!(!classify("logs/HEAD"));
    }

    #[test]
    fn ignores_paths_outside_git_dir() {
        assert!(!classify_head_change(
            Path::new("/other/.git/HEAD"),
            &git_dir(),
        ));
    }

    #[test]
    fn resolve_git_dir_returns_none_outside_repo() {
        assert!(resolve_git_dir("/this/path/is/not/a/vixl-git-repo").is_none());
    }
}
