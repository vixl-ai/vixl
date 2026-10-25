use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};

use super::paths::{resolve_project_vixl_dir, user_vixl_dir};

const PERSONAL_CONFIG_DIRS: [&str; 4] = ["agents", "rules", "skills", "plans"];
const PERSONAL_ROOT_FILES: [&str; 4] = ["settings.json", "mcp.json", "AGENTS.md", "agents.md"];
const EMIT_DEBOUNCE: Duration = Duration::from_millis(350);
const ROOT_FILE_POLL: Duration = Duration::from_millis(500);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VixlFileChange {
    pub scope: String,
    pub root_path: Option<String>,
    pub kind: String,
}

struct PersonalWatchTargets {
    dirs: Vec<PathBuf>,
    files: Vec<PathBuf>,
}

struct CoalesceState {
    pending: Option<VixlFileChange>,
    timer: Option<JoinHandle<()>>,
}

struct ActiveWatch {
    _dir_watcher: RecommendedWatcher,
    coalesce: Arc<Mutex<CoalesceState>>,
    poll_handle: JoinHandle<()>,
}

impl Drop for ActiveWatch {
    fn drop(&mut self) {
        self.poll_handle.abort();
        if let Ok(mut state) = self.coalesce.lock() {
            if let Some(timer) = state.timer.take() {
                timer.abort();
            }
        }
    }
}

pub struct WatchState {
    inner: Mutex<Option<ActiveWatch>>,
}

impl WatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn personal_watch_targets(personal_dir: &Path) -> PersonalWatchTargets {
    PersonalWatchTargets {
        dirs: PERSONAL_CONFIG_DIRS
            .iter()
            .map(|name| personal_dir.join(name))
            .collect(),
        files: PERSONAL_ROOT_FILES
            .iter()
            .map(|name| personal_dir.join(name))
            .collect(),
    }
}

fn arm_coalesced_emit(
    pending: &mut Option<VixlFileChange>,
    timer_armed: bool,
    change: VixlFileChange,
) -> bool {
    *pending = Some(change);
    !timer_armed
}

fn queue_classified_change(
    app: &AppHandle,
    coalesce: &Arc<Mutex<CoalesceState>>,
    change: VixlFileChange,
) {
    let Ok(mut state) = coalesce.lock() else {
        return;
    };
    let timer_armed = state.timer.is_some();
    let start_timer = arm_coalesced_emit(&mut state.pending, timer_armed, change);
    if !start_timer {
        return;
    }
    let app = app.clone();
    let coalesce = Arc::clone(coalesce);
    state.timer = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(EMIT_DEBOUNCE).await;
        let change = {
            let Ok(mut state) = coalesce.lock() else {
                return;
            };
            state.timer = None;
            state.pending.take()
        };
        if let Some(change) = change {
            let _ = app.emit("vixl-file-changed", change);
        }
    }));
}

fn ingest_notify_event(
    event: Event,
    personal_dir: &Path,
    project_dir: Option<&Path>,
    project_root: Option<&str>,
    overlaps_personal: bool,
    app: &AppHandle,
    coalesce: &Arc<Mutex<CoalesceState>>,
) {
    match event.kind {
        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) => {}
        _ => return,
    }

    let mut latest_change: Option<VixlFileChange> = None;
    for path in event.paths {
        if let Some(change) = classify_scoped_change(
            &path,
            personal_dir,
            project_dir,
            project_root,
            overlaps_personal,
        ) {
            latest_change = Some(change);
        }
    }

    let Some(change) = latest_change else {
        return;
    };
    queue_classified_change(app, coalesce, change);
}

fn root_file_signature(path: &Path) -> Option<(u128, u64)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Some((modified, meta.len()))
}

fn start_root_file_poll(
    app: AppHandle,
    coalesce: Arc<Mutex<CoalesceState>>,
    files: Vec<PathBuf>,
    personal_dir: PathBuf,
    project_dir: Option<PathBuf>,
    project_root: Option<String>,
    overlaps_personal: bool,
) -> JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut signatures: Vec<Option<(u128, u64)>> =
            files.iter().map(|path| root_file_signature(path)).collect();
        loop {
            tokio::time::sleep(ROOT_FILE_POLL).await;
            for (index, path) in files.iter().enumerate() {
                let next = root_file_signature(path);
                if signatures.get(index) == Some(&next) {
                    continue;
                }
                if let Some(slot) = signatures.get_mut(index) {
                    *slot = next;
                }
                if let Some(change) = classify_scoped_change(
                    path,
                    &personal_dir,
                    project_dir.as_deref(),
                    project_root.as_deref(),
                    overlaps_personal,
                ) {
                    queue_classified_change(&app, &coalesce, change);
                }
            }
        }
    })
}

#[cfg(test)]
fn classify_change(
    path: &Path,
    personal_dir: &Path,
    project_dir: Option<&Path>,
    project_root: Option<&str>,
) -> Option<VixlFileChange> {
    let overlaps_personal = project_dir.is_some_and(|dir| same_watch_dir(personal_dir, dir));
    classify_scoped_change(
        path,
        personal_dir,
        project_dir,
        project_root,
        overlaps_personal,
    )
}

fn classify_scoped_change(
    path: &Path,
    personal_dir: &Path,
    project_dir: Option<&Path>,
    project_root: Option<&str>,
    overlaps_personal: bool,
) -> Option<VixlFileChange> {
    let personal_worktrees = personal_dir.join("worktrees");
    if path.starts_with(&personal_worktrees) {
        let in_open_worktree_project = !overlaps_personal
            && project_dir.is_some_and(|dir| {
                dir.starts_with(&personal_worktrees) && path.starts_with(dir)
            });
        if !in_open_worktree_project {
            return None;
        }
    }

    // A home workspace resolves the project tree to the personal tree. Paths
    // under either spelling of that directory stay personal.
    let in_personal = !path.starts_with(&personal_worktrees)
        && (path.starts_with(personal_dir)
            || (overlaps_personal && project_dir.is_some_and(|dir| path.starts_with(dir))));
    let in_project = !overlaps_personal && project_dir.is_some_and(|dir| path.starts_with(dir));

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

/// True when `project_dir` is the same directory as `personal_dir`.
///
/// Exact path equality matches first. Otherwise both sides are canonicalized,
/// so a symlink or a `.` / `..` spelling still counts as one watch root.
fn same_watch_dir(personal_dir: &Path, project_dir: &Path) -> bool {
    if personal_dir == project_dir {
        return true;
    }
    match (
        dunce::canonicalize(personal_dir),
        dunce::canonicalize(project_dir),
    ) {
        (Ok(personal), Ok(project)) => personal == project,
        _ => false,
    }
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

    let overlaps_personal = project_dir
        .as_ref()
        .is_some_and(|dir| same_watch_dir(&personal_dir, dir));
    let personal_dir_for_handler = personal_dir.clone();
    let project_dir_for_handler = project_dir.clone();
    let project_root_for_handler = project_root.clone();
    let app_handle = app.clone();
    let coalesce = Arc::new(Mutex::new(CoalesceState {
        pending: None,
        timer: None,
    }));
    let coalesce_for_handler = Arc::clone(&coalesce);
    let targets = personal_watch_targets(&personal_dir);

    let mut dir_watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let Ok(event) = result else {
                return;
            };
            ingest_notify_event(
                event,
                &personal_dir_for_handler,
                project_dir_for_handler.as_deref(),
                project_root_for_handler.as_deref(),
                overlaps_personal,
                &app_handle,
                &coalesce_for_handler,
            );
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    for dir in &targets.dirs {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        dir_watcher
            .watch(dir, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }

    // Home as the workspace root resolves the project tree to ~/.vixl.
    // A second recursive watch on that same directory emits duplicate events.
    if let Some(dir) = project_dir.clone() {
        if dir.exists() && !overlaps_personal {
            dir_watcher
                .watch(&dir, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }

    let poll_handle = start_root_file_poll(
        app.clone(),
        Arc::clone(&coalesce),
        targets.files,
        personal_dir,
        project_dir,
        project_root,
        overlaps_personal,
    );

    *guard = Some(ActiveWatch {
        _dir_watcher: dir_watcher,
        coalesce,
        poll_handle,
    });
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

    fn sample_change(kind: &str) -> VixlFileChange {
        VixlFileChange {
            scope: "personal".to_string(),
            root_path: None,
            kind: kind.to_string(),
        }
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

    #[test]
    fn classifies_home_root_overlap_as_personal() {
        let personal = personal_dir();
        let change = classify_change(
            &personal.join("settings.json"),
            &personal,
            Some(&personal),
            Some("/home/user"),
        )
        .expect("classified");
        assert_eq!(change.kind, "settings");
        assert_eq!(change.scope, "personal");
        assert!(change.root_path.is_none());
    }

    #[test]
    fn classifies_canonical_home_spelling_as_personal() {
        let temp = std::env::temp_dir().join(format!("vixl-watch-classify-{}", std::process::id()));
        let personal = temp.join(".vixl");
        std::fs::create_dir_all(&personal).expect("mkdir");
        let via_dot = temp.join(".").join(".vixl");
        let change = classify_change(
            &via_dot.join("mcp.json"),
            &personal,
            Some(&via_dot),
            Some(temp.to_str().unwrap_or("/tmp")),
        );
        let _ = std::fs::remove_dir_all(&temp);
        let change = change.expect("classified");
        assert_eq!(change.kind, "mcp");
        assert_eq!(change.scope, "personal");
        assert!(change.root_path.is_none());
    }

    #[test]
    fn same_watch_dir_matches_equal_paths() {
        let personal = personal_dir();
        assert!(same_watch_dir(&personal, &personal));
    }

    #[test]
    fn same_watch_dir_rejects_distinct_project_dir() {
        assert!(!same_watch_dir(&personal_dir(), &project_vixl_dir()));
    }

    #[test]
    fn same_watch_dir_matches_canonical_equivalent() {
        let temp = std::env::temp_dir().join(format!("vixl-watch-dedup-{}", std::process::id()));
        let personal = temp.join(".vixl");
        std::fs::create_dir_all(&personal).expect("mkdir");
        let via_dot = temp.join(".").join(".vixl");
        let matches = same_watch_dir(&personal, &via_dot);
        let _ = std::fs::remove_dir_all(&temp);
        assert!(matches);
    }

    #[test]
    fn ignores_worktree_checkout_skill_path() {
        let change = classify_personal("worktrees/demo/feature/src/services/skills/SKILL.md");
        assert!(change.is_none());
    }

    #[test]
    fn classifies_personal_skill_file() {
        let change = classify_personal("skills/demo/SKILL.md").expect("classified");
        assert_eq!(change.kind, "skills");
        assert_eq!(change.scope, "personal");
        assert!(change.root_path.is_none());
    }

    #[test]
    fn classifies_open_worktree_project_skill_file() {
        let personal = personal_dir();
        let worktree_root = personal.join("worktrees").join("demo").join("feature");
        let project_dir = worktree_root.join(".vixl");
        let change = classify_change(
            &project_dir.join("skills").join("demo").join("SKILL.md"),
            &personal,
            Some(&project_dir),
            worktree_root.to_str(),
        )
        .expect("classified");
        assert_eq!(change.kind, "skills");
        assert_eq!(change.scope, "project");
        assert_eq!(change.root_path.as_deref(), worktree_root.to_str());
    }

    #[test]
    fn personal_watch_targets_exclude_root_and_worktrees() {
        let personal = personal_dir();
        let targets = personal_watch_targets(&personal);
        assert_eq!(
            targets.dirs,
            vec![
                personal.join("agents"),
                personal.join("rules"),
                personal.join("skills"),
                personal.join("plans"),
            ]
        );
        assert_eq!(
            targets.files,
            vec![
                personal.join("settings.json"),
                personal.join("mcp.json"),
                personal.join("AGENTS.md"),
                personal.join("agents.md"),
            ]
        );
        assert!(!targets.dirs.contains(&personal));
        assert!(!targets.files.contains(&personal));
        assert!(targets
            .dirs
            .iter()
            .chain(targets.files.iter())
            .all(|path| !has_path_segment(path, "worktrees")));
    }

    #[test]
    fn coalesces_burst_to_single_pending_emit() {
        let mut pending = None;
        let mut timer_armed = false;
        let mut start_count = 0;
        for kind in ["settings", "mcp", "skills"] {
            if arm_coalesced_emit(&mut pending, timer_armed, sample_change(kind)) {
                start_count += 1;
                timer_armed = true;
            }
        }
        assert_eq!(start_count, 1);
        let change = pending.expect("pending emit");
        assert_eq!(change.kind, "skills");
        assert_eq!(change.scope, "personal");
    }
}
