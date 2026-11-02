use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use notify::event::{ModifyKind, RenameMode};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

use super::fs::{canonical_project_root, parse_ssh_project_root, resolve_workspace_path};
use super::skip_dirs::skip_directory;
use super::ssh::{
    close_channel, inotify_enospc, inotifywait_missing, is_ssh_root, key_for, login_command,
    looks_like_enospc, map_unreachable, open_exec, posix_quote, probe_remote_program,
    take_channel_stdio,
};

const DEBOUNCE_MS: u64 = 150;
const MAX_PARENTS: usize = 50;
const MAX_WATCHES: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeChanged {
    pub root_path: String,
    pub directories: Vec<String>,
    pub rescan: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceWatchMode {
    Shallow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InitialWatch {
    RecursiveRoot,
    NonRecursiveTree,
    PathsOnly,
}

#[derive(Default)]
struct Burst {
    directories: HashSet<String>,
    rescan: bool,
    new_dirs: Vec<PathBuf>,
}

impl Burst {
    fn take(&mut self) -> Self {
        std::mem::take(self)
    }
}

enum WatchInput {
    Event(Event),
    Error,
}

struct Shared {
    root: PathBuf,
    root_path: String,
    app: AppHandle,
    shallow: bool,
    recursive: bool,
    stopped: AtomicBool,
    cap_hit: AtomicBool,
    pending: Mutex<Burst>,
    timer: Mutex<Option<JoinHandle<()>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Mutex<HashSet<PathBuf>>,
}

struct RootEntry {
    refcount: usize,
    shared: Arc<Shared>,
}

struct RemoteWatch {
    refcount: usize,
    channel_id: String,
    stopped: Arc<AtomicBool>,
}

enum RemoteClaim {
    Joined,
    Started(Arc<AtomicBool>),
}

fn claim_remote(map: &mut HashMap<String, RemoteWatch>, key: String) -> RemoteClaim {
    if let Some(entry) = map.get_mut(&key) {
        if !entry.stopped.load(Ordering::SeqCst) {
            entry.refcount = entry.refcount.saturating_add(1);
            return RemoteClaim::Joined;
        }
        map.remove(&key);
    }
    let stopped = Arc::new(AtomicBool::new(false));
    map.insert(
        key,
        RemoteWatch {
            refcount: 1,
            channel_id: String::new(),
            stopped: stopped.clone(),
        },
    );
    RemoteClaim::Started(stopped)
}

fn drop_remote_start(map: &mut HashMap<String, RemoteWatch>, key: &str, stopped: &Arc<AtomicBool>) {
    let still_starting = map
        .get(key)
        .is_some_and(|entry| Arc::ptr_eq(&entry.stopped, stopped) && entry.channel_id.is_empty());
    if !still_starting {
        return;
    }
    if let Some(entry) = map.get_mut(key) {
        entry.stopped.store(true, Ordering::SeqCst);
    }
    map.remove(key);
}

fn publish_remote_channel(
    map: &mut HashMap<String, RemoteWatch>,
    key: &str,
    stopped: &Arc<AtomicBool>,
    channel_id: String,
) -> bool {
    let Some(entry) = map.get_mut(key) else {
        return false;
    };
    if !Arc::ptr_eq(&entry.stopped, stopped) || entry.stopped.load(Ordering::SeqCst) {
        return false;
    }
    entry.channel_id = channel_id;
    true
}

pub struct WorkspaceWatchState {
    inner: Mutex<HashMap<String, RootEntry>>,
    remote: Mutex<HashMap<String, RemoteWatch>>,
}

impl WorkspaceWatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            remote: Mutex::new(HashMap::new()),
        }
    }
}

fn is_shallow_mode(mode: Option<WorkspaceWatchMode>) -> bool {
    matches!(mode, Some(WorkspaceWatchMode::Shallow))
}

fn uses_recursive_watch(shallow: bool) -> bool {
    !shallow && !cfg!(any(target_os = "linux", target_os = "android"))
}

fn initial_watch(shallow: bool) -> InitialWatch {
    if uses_recursive_watch(shallow) {
        InitialWatch::RecursiveRoot
    } else if !shallow {
        InitialWatch::NonRecursiveTree
    } else {
        InitialWatch::PathsOnly
    }
}

fn relative_is_excluded(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => skip_directory(&name.to_string_lossy()),
        _ => false,
    })
}

fn normalize_rel(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.is_empty() {
        ".".to_string()
    } else {
        text
    }
}

fn parent_directory(root: &Path, changed: &Path) -> Option<String> {
    let relative = changed.strip_prefix(root).ok()?;
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    if relative_is_excluded(parent) {
        return None;
    }
    Some(normalize_rel(parent))
}

fn is_structural(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any
            | EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Any | ModifyKind::Name(_))
    )
}

fn is_created_or_renamed_to(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any
            | EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Name(
                RenameMode::To | RenameMode::Both | RenameMode::Any
            ))
    )
}

fn ingest(root: &Path, input: WatchInput, burst: &mut Burst) {
    let event = match input {
        WatchInput::Error => {
            burst.rescan = true;
            return;
        }
        WatchInput::Event(event) => event,
    };

    if event.need_rescan() {
        burst.rescan = true;
        return;
    }

    let kind = event.kind;
    if !is_structural(kind) {
        return;
    }

    let track_new_dirs = is_created_or_renamed_to(kind);
    for path in event.paths {
        if let Some(parent) = parent_directory(root, &path) {
            burst.directories.insert(parent);
        }
        if track_new_dirs {
            burst.new_dirs.push(path);
        }
    }
}

fn finalize_burst(
    root_path: &str,
    directories: HashSet<String>,
    rescan: bool,
    cap_hit: bool,
) -> Option<WorkspaceTreeChanged> {
    let rescan = rescan || cap_hit || directories.len() > MAX_PARENTS;
    if rescan {
        return Some(WorkspaceTreeChanged {
            root_path: root_path.to_string(),
            directories: Vec::new(),
            rescan: true,
        });
    }
    if directories.is_empty() {
        return None;
    }
    let mut directories: Vec<_> = directories.into_iter().collect();
    directories.sort();
    Some(WorkspaceTreeChanged {
        root_path: root_path.to_string(),
        directories,
        rescan: false,
    })
}

fn should_watch_created_directory(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    if relative.as_os_str().is_empty() {
        return false;
    }
    if relative_is_excluded(relative) {
        return false;
    }
    fs::symlink_metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

fn collect_watchable_dirs(root: &Path, cap: usize) -> (Vec<PathBuf>, bool) {
    let mut dirs = Vec::new();
    let mut stack = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = stack.pop_front() {
        if dirs.len() >= cap {
            return (dirs, true);
        }
        dirs.push(dir.clone());
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if skip_directory(name.as_ref()) {
                continue;
            }
            stack.push_back(entry.path());
        }
    }
    (dirs, false)
}

fn watch_dir(
    watcher: &mut RecommendedWatcher,
    watched: &mut HashSet<PathBuf>,
    cap_hit: &AtomicBool,
    path: PathBuf,
) -> Result<(), String> {
    if watched.contains(&path) {
        return Ok(());
    }
    if watched.len() >= MAX_WATCHES {
        cap_hit.store(true, Ordering::SeqCst);
        return Ok(());
    }
    match watcher.watch(&path, RecursiveMode::NonRecursive) {
        Ok(()) => {
            watched.insert(path);
            Ok(())
        }
        Err(error) => {
            if watched.is_empty() {
                Err(error.to_string())
            } else {
                cap_hit.store(true, Ordering::SeqCst);
                Ok(())
            }
        }
    }
}

fn apply_new_dir_watches(shared: &Shared, new_dirs: Vec<PathBuf>) {
    let mut watcher = match shared.watcher.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let Some(watcher) = watcher.as_mut() else {
        return;
    };
    let mut watched = match shared.watched.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    for path in new_dirs {
        if !should_watch_created_directory(&shared.root, &path) {
            continue;
        }
        let _ = watch_dir(watcher, &mut watched, &shared.cap_hit, path);
    }
}

fn target_watch_dirs(root: &Path, root_path: &str, paths: &[String]) -> HashSet<PathBuf> {
    let mut target = HashSet::new();
    for relative in paths {
        let Ok(absolute) = resolve_workspace_path(root_path, relative) else {
            continue;
        };
        if !absolute.is_dir() {
            continue;
        }
        let Ok(stripped) = absolute.strip_prefix(root) else {
            continue;
        };
        if relative_is_excluded(stripped) {
            continue;
        }
        target.insert(absolute);
    }
    target
}

enum ReplaceOp<'a> {
    Watch(&'a Path),
    Unwatch(&'a Path),
}

fn apply_watch_replace(
    watched: &mut HashSet<PathBuf>,
    target: &HashSet<PathBuf>,
    mut operate: impl FnMut(ReplaceOp<'_>) -> Result<(), String>,
) -> Result<(), String> {
    let had_watches = !watched.is_empty();
    let to_watch: Vec<PathBuf> = target.difference(watched).cloned().collect();
    let mut errors = Vec::new();
    for path in to_watch {
        match operate(ReplaceOp::Watch(&path)) {
            Ok(()) => {
                watched.insert(path);
            }
            Err(error) => errors.push(error),
        }
    }

    let covers_target = watched.intersection(target).next().is_some();
    if errors.is_empty() || covers_target {
        let to_unwatch: Vec<PathBuf> = watched.difference(target).cloned().collect();
        for path in to_unwatch {
            let _ = operate(ReplaceOp::Unwatch(&path));
            watched.remove(&path);
        }
    }

    if !errors.is_empty() && watched.is_empty() && !had_watches {
        return Err(errors.join("; "));
    }
    if !errors.is_empty() {
        log::warn!("Failed to update workspace watches: {}", errors.join("; "));
    }
    Ok(())
}

fn replace_non_recursive_watches(shared: &Shared, paths: &[String]) -> Result<(), String> {
    let mut watcher = shared.watcher.lock().map_err(|error| error.to_string())?;
    let Some(watcher) = watcher.as_mut() else {
        return Ok(());
    };
    let mut watched = shared.watched.lock().map_err(|error| error.to_string())?;
    let target = target_watch_dirs(&shared.root, &shared.root_path, paths);
    apply_watch_replace(&mut watched, &target, |op| match op {
        ReplaceOp::Watch(path) => watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string()),
        ReplaceOp::Unwatch(path) => {
            let _ = watcher.unwatch(path);
            Ok(())
        }
    })
}

fn handle_notify(shared: &Arc<Shared>, result: Result<Event, notify::Error>) {
    if shared.stopped.load(Ordering::SeqCst) {
        return;
    }

    let input = match result {
        Ok(event) => WatchInput::Event(event),
        Err(_) => WatchInput::Error,
    };

    let should_flush = {
        let Ok(mut pending) = shared.pending.lock() else {
            return;
        };
        let before_dirs = pending.directories.len();
        let before_rescan = pending.rescan;
        ingest(&shared.root, input, &mut pending);
        pending.rescan != before_rescan
            || pending.directories.len() != before_dirs
            || !pending.new_dirs.is_empty()
    };

    if should_flush {
        schedule_flush(shared);
    }
}

fn schedule_flush(shared: &Arc<Shared>) {
    if shared.stopped.load(Ordering::SeqCst) {
        return;
    }
    let Ok(mut timer) = shared.timer.lock() else {
        return;
    };
    if let Some(handle) = timer.take() {
        handle.abort();
    }
    let shared = Arc::clone(shared);
    *timer = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;
        flush_and_emit(&shared);
    }));
}

fn flush_and_emit(shared: &Arc<Shared>) {
    if shared.stopped.load(Ordering::SeqCst) {
        return;
    }

    let burst = {
        let Ok(mut pending) = shared.pending.lock() else {
            return;
        };
        pending.take()
    };

    if !shared.shallow && !shared.recursive {
        apply_new_dir_watches(shared, burst.new_dirs);
    }

    let cap_hit = shared.cap_hit.load(Ordering::SeqCst);
    let Some(payload) = finalize_burst(&shared.root_path, burst.directories, burst.rescan, cap_hit)
    else {
        return;
    };
    if shared.stopped.load(Ordering::SeqCst) {
        return;
    }
    let _ = shared.app.emit("workspace-tree-changed", payload);
}

fn stop_shared(shared: &Shared) {
    shared.stopped.store(true, Ordering::SeqCst);
    if let Ok(mut timer) = shared.timer.lock() {
        if let Some(handle) = timer.take() {
            handle.abort();
        }
    }
    if let Ok(mut watcher) = shared.watcher.lock() {
        *watcher = None;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchAcquire {
    Reuse { refcount: usize },
    Restart { refcount: usize },
    Start { refcount: usize },
}

fn acquire_watch(existing: Option<(usize, bool)>, shallow: bool) -> WatchAcquire {
    match existing {
        Some((refcount, existing_shallow)) if existing_shallow == shallow => WatchAcquire::Reuse {
            refcount: refcount.saturating_add(1),
        },
        Some(_) => WatchAcquire::Restart { refcount: 1 },
        None => WatchAcquire::Start { refcount: 1 },
    }
}

fn start_session(app: AppHandle, root: PathBuf, shallow: bool) -> Result<Arc<Shared>, String> {
    let root_path = root.to_string_lossy().to_string();
    let recursive = uses_recursive_watch(shallow);
    let shared = Arc::new(Shared {
        root: root.clone(),
        root_path,
        app,
        shallow,
        recursive,
        stopped: AtomicBool::new(false),
        cap_hit: AtomicBool::new(false),
        pending: Mutex::new(Burst::default()),
        timer: Mutex::new(None),
        watcher: Mutex::new(None),
        watched: Mutex::new(HashSet::new()),
    });
    let weak: Weak<Shared> = Arc::downgrade(&shared);
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let Some(shared) = weak.upgrade() else {
                return;
            };
            handle_notify(&shared, result);
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    match initial_watch(shallow) {
        InitialWatch::RecursiveRoot => {
            watcher
                .watch(&root, RecursiveMode::Recursive)
                .map_err(|error| error.to_string())?;
            if let Ok(mut watched) = shared.watched.lock() {
                watched.insert(root);
            }
        }
        InitialWatch::NonRecursiveTree => {
            let (dirs, truncated) = collect_watchable_dirs(&root, MAX_WATCHES);
            if truncated {
                shared.cap_hit.store(true, Ordering::SeqCst);
            }
            let mut watched = HashSet::new();
            for dir in dirs {
                watch_dir(&mut watcher, &mut watched, &shared.cap_hit, dir)?;
            }
            if let Ok(mut slot) = shared.watched.lock() {
                *slot = watched;
            }
        }
        InitialWatch::PathsOnly => {}
    }

    *shared.watcher.lock().map_err(|error| error.to_string())? = Some(watcher);
    Ok(shared)
}

#[tauri::command]
pub async fn watch_workspace(
    app: AppHandle,
    project_root: String,
    mode: Option<WorkspaceWatchMode>,
) -> Result<String, String> {
    if is_ssh_root(&project_root) {
        return watch_workspace_ssh(app, project_root).await;
    }
    let root = canonical_project_root(&project_root)?;
    let key = root.to_string_lossy().to_string();
    let shallow = is_shallow_mode(mode);
    let state = app.state::<WorkspaceWatchState>();

    {
        let mut map = state.inner.lock().map_err(|error| error.to_string())?;
        match acquire_watch(
            map.get(&key)
                .map(|entry| (entry.refcount, entry.shared.shallow)),
            shallow,
        ) {
            WatchAcquire::Reuse { refcount } => {
                if let Some(entry) = map.get_mut(&key) {
                    entry.refcount = refcount;
                }
                return Ok(key);
            }
            WatchAcquire::Restart { .. } => {
                if let Some(entry) = map.remove(&key) {
                    stop_shared(&entry.shared);
                }
            }
            WatchAcquire::Start { .. } => {}
        }
    }

    let shared = start_session(app.clone(), root, shallow)?;
    let mut map = state.inner.lock().map_err(|error| error.to_string())?;
    match acquire_watch(
        map.get(&key)
            .map(|entry| (entry.refcount, entry.shared.shallow)),
        shallow,
    ) {
        WatchAcquire::Reuse { refcount } => {
            if let Some(entry) = map.get_mut(&key) {
                entry.refcount = refcount;
            }
            stop_shared(&shared);
        }
        WatchAcquire::Restart { refcount } => {
            if let Some(entry) = map.remove(&key) {
                stop_shared(&entry.shared);
            }
            map.insert(key.clone(), RootEntry { refcount, shared });
        }
        WatchAcquire::Start { refcount } => {
            map.insert(key.clone(), RootEntry { refcount, shared });
        }
    }
    Ok(key)
}

fn unwatch_session_key(project_root: &str, contains_key: impl Fn(&str) -> bool) -> Option<String> {
    match canonical_project_root(project_root) {
        Ok(root) => Some(root.to_string_lossy().to_string()),
        Err(_) if contains_key(project_root) => Some(project_root.to_string()),
        Err(_) => None,
    }
}

#[tauri::command]
pub async fn unwatch_workspace(app: AppHandle, project_root: String) -> Result<(), String> {
    let state = app.state::<WorkspaceWatchState>();
    if is_ssh_root(&project_root) {
        let key = project_root.trim().to_string();
        let channel_id = {
            let mut map = state.remote.lock().map_err(|error| error.to_string())?;
            let Some(entry) = map.get_mut(&key) else {
                return Ok(());
            };
            entry.refcount = entry.refcount.saturating_sub(1);
            if entry.refcount > 0 {
                return Ok(());
            }
            entry.stopped.store(true, Ordering::SeqCst);
            let channel_id = std::mem::take(&mut entry.channel_id);
            map.remove(&key);
            channel_id
        };
        if !channel_id.is_empty() {
            let _ = close_channel(channel_id).await;
        }
        return Ok(());
    }
    let mut map = state.inner.lock().map_err(|error| error.to_string())?;
    let Some(key) = unwatch_session_key(&project_root, |candidate| map.contains_key(candidate))
    else {
        return Ok(());
    };
    let Some(entry) = map.get_mut(&key) else {
        return Ok(());
    };
    entry.refcount = entry.refcount.saturating_sub(1);
    if entry.refcount == 0 {
        if let Some(entry) = map.remove(&key) {
            stop_shared(&entry.shared);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn watch_workspace_paths(
    app: AppHandle,
    project_root: String,
    paths: Vec<String>,
) -> Result<(), String> {
    if is_ssh_root(&project_root) {
        let key = project_root.trim().to_string();
        let state = app.state::<WorkspaceWatchState>();
        let map = state.remote.lock().map_err(|error| error.to_string())?;
        if map.contains_key(&key) {
            return Ok(());
        }
        return Err("Workspace is not being watched".to_string());
    }
    let root = canonical_project_root(&project_root)?;
    let key = root.to_string_lossy().to_string();
    let state = app.state::<WorkspaceWatchState>();
    let map = state.inner.lock().map_err(|error| error.to_string())?;
    let Some(entry) = map.get(&key) else {
        return Err("Workspace is not being watched".to_string());
    };
    if !entry.shared.shallow {
        return Ok(());
    }
    let shared = Arc::clone(&entry.shared);
    drop(map);
    replace_non_recursive_watches(&shared, &paths)
}

async fn watch_workspace_ssh(app: AppHandle, project_root: String) -> Result<String, String> {
    let key = project_root.trim().to_string();
    let ssh = parse_ssh_project_root(&key)?;
    let state = app.state::<WorkspaceWatchState>();
    let stopped = {
        let mut map = state.remote.lock().map_err(|error| error.to_string())?;
        match claim_remote(&mut map, key.clone()) {
            RemoteClaim::Joined => return Ok(key),
            RemoteClaim::Started(stopped) => stopped,
        }
    };
    if let Err(err) = open_remote_inotify(&ssh).await {
        let mut map = state.remote.lock().map_err(|error| error.to_string())?;
        drop_remote_start(&mut map, &key, &stopped);
        return Err(err);
    }
    let mut stdio = match take_remote_inotify_stdio(&ssh).await {
        Ok(stdio) => stdio,
        Err(err) => {
            let mut map = state.remote.lock().map_err(|error| error.to_string())?;
            drop_remote_start(&mut map, &key, &stopped);
            return Err(err);
        }
    };
    drop(stdio.stdin);
    let channel_id = stdio.channel_id.clone();
    if stopped.load(Ordering::SeqCst) {
        {
            let mut map = state.remote.lock().map_err(|error| error.to_string())?;
            drop_remote_start(&mut map, &key, &stopped);
        }
        let _ = close_channel(channel_id).await;
        return Ok(key);
    }
    let hostname = ssh.hostname.clone();
    let stderr_stopped = stopped.clone();
    let stderr_channel = channel_id.clone();
    if let Some(stderr) = stdio.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if looks_like_enospc(&line) {
                    stderr_stopped.store(true, Ordering::SeqCst);
                    log::warn!("{}", inotify_enospc(&hostname));
                    let _ = close_channel(stderr_channel).await;
                    break;
                }
            }
        });
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    if stopped.load(Ordering::SeqCst) {
        let unwatched = {
            let mut map = state.remote.lock().map_err(|error| error.to_string())?;
            let unwatched = map
                .get(&key)
                .is_none_or(|entry| !Arc::ptr_eq(&entry.stopped, &stopped));
            drop_remote_start(&mut map, &key, &stopped);
            unwatched
        };
        let _ = close_channel(channel_id).await;
        if unwatched {
            return Ok(key);
        }
        return Err(inotify_enospc(&ssh.hostname));
    }
    let published = {
        let mut map = state.remote.lock().map_err(|error| error.to_string())?;
        publish_remote_channel(&mut map, &key, &stopped, channel_id.clone())
    };
    if !published {
        stopped.store(true, Ordering::SeqCst);
        let _ = close_channel(channel_id).await;
        return Ok(key);
    }
    let remote_path = ssh.remote_path.clone();
    let root_path = key.clone();
    let stdout_stopped = stopped.clone();
    let app_watch = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdio.stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if stdout_stopped.load(Ordering::SeqCst) {
                break;
            }
            if let Some(payload) = remote_watch_payload(&root_path, &remote_path, &line) {
                let _ = app_watch.emit("workspace-tree-changed", payload);
            }
        }
    });
    Ok(key)
}

async fn open_remote_inotify(ssh: &crate::commands::fs::SshProjectRoot) -> Result<(), String> {
    probe_remote_program(ssh, "inotifywait")
        .await
        .map_err(|err| {
            if err.contains("is not installed") {
                inotifywait_missing(&ssh.hostname)
            } else {
                err
            }
        })?;
    Ok(())
}

async fn take_remote_inotify_stdio(
    ssh: &crate::commands::fs::SshProjectRoot,
) -> Result<crate::commands::ssh::ChannelStdio, String> {
    let command = format!(
        "inotifywait -m -r -e create,delete,move,modify --format '%w%f|%e' {}",
        posix_quote(&ssh.remote_path)
    );
    let info = open_exec(key_for(ssh), login_command(&ssh.remote_path, &command))
        .await
        .map_err(|err| map_unreachable(&ssh.hostname, err))?;
    take_channel_stdio(&info.channel_id)
        .await
        .map_err(|err| map_unreachable(&ssh.hostname, err))
}

fn remote_watch_payload(
    root_path: &str,
    remote_path: &str,
    line: &str,
) -> Option<WorkspaceTreeChanged> {
    let path = line.split('|').next().unwrap_or(line).trim();
    if path.is_empty() {
        return None;
    }
    let relative = path
        .strip_prefix(remote_path)
        .unwrap_or(path)
        .trim_start_matches('/');
    let relative_path = Path::new(relative);
    if relative_is_excluded(relative_path) {
        return None;
    }
    let parent = relative_path
        .parent()
        .map(normalize_rel)
        .unwrap_or_else(|| ".".to_string());
    Some(WorkspaceTreeChanged {
        root_path: root_path.to_string(),
        directories: vec![parent],
        rescan: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, Flag, MetadataKind, RemoveKind};
    use std::collections::HashSet;
    use std::time::{Duration, Instant};

    fn root() -> PathBuf {
        PathBuf::from("/workspace")
    }

    fn join(relative: &str) -> PathBuf {
        let mut path = root();
        for part in relative.split('/') {
            if !part.is_empty() && part != "." {
                path.push(part);
            }
        }
        path
    }

    fn ingest_path(kind: EventKind, relative: &str) -> Burst {
        let mut burst = Burst::default();
        ingest(
            &root(),
            WatchInput::Event(Event::new(kind).add_path(join(relative))),
            &mut burst,
        );
        burst
    }

    #[test]
    fn unwatch_during_ssh_setup_drops_the_claim() {
        let mut map = HashMap::new();
        let stopped = match claim_remote(
            &mut map,
            "ssh://johnny@appleseed.example/home/johnny".into(),
        ) {
            RemoteClaim::Started(stopped) => stopped,
            RemoteClaim::Joined => panic!("first claim should start"),
        };
        assert!(matches!(
            claim_remote(
                &mut map,
                "ssh://johnny@appleseed.example/home/johnny".into()
            ),
            RemoteClaim::Joined
        ));
        stopped.store(true, Ordering::SeqCst);
        map.remove("ssh://johnny@appleseed.example/home/johnny");
        assert!(!publish_remote_channel(
            &mut map,
            "ssh://johnny@appleseed.example/home/johnny",
            &stopped,
            "channel".into(),
        ));
        assert!(map.is_empty());
    }

    #[test]
    fn failed_ssh_setup_removes_its_claim() {
        let mut map = HashMap::new();
        let key = "ssh://johnny@appleseed.example/home/johnny";
        let stopped = match claim_remote(&mut map, key.into()) {
            RemoteClaim::Started(stopped) => stopped,
            RemoteClaim::Joined => panic!("first claim should start"),
        };
        drop_remote_start(&mut map, key, &stopped);
        assert!(map.is_empty());
        assert!(matches!(
            claim_remote(&mut map, key.into()),
            RemoteClaim::Started(_)
        ));
    }

    #[test]
    fn default_mode_is_not_shallow() {
        assert!(!is_shallow_mode(None));
        let unknown = serde_json::from_str::<WorkspaceWatchMode>("\"tree\"");
        assert!(unknown.is_err());
    }

    #[test]
    fn shallow_mode_deserializes_from_ipc_string() {
        let mode: WorkspaceWatchMode = serde_json::from_str("\"shallow\"").expect("shallow mode");
        assert!(is_shallow_mode(Some(mode)));
        assert_eq!(initial_watch(true), InitialWatch::PathsOnly);
        assert!(!uses_recursive_watch(true));
    }

    #[test]
    fn default_mode_watches_the_tree_even_for_home_path() {
        let plan = initial_watch(false);
        assert_ne!(plan, InitialWatch::PathsOnly);
        if cfg!(any(target_os = "linux", target_os = "android")) {
            assert_eq!(plan, InitialWatch::NonRecursiveTree);
        } else {
            assert_eq!(plan, InitialWatch::RecursiveRoot);
        }
    }

    #[test]
    fn same_mode_reuses_session_and_increments_refcount() {
        assert_eq!(
            acquire_watch(None, false),
            WatchAcquire::Start { refcount: 1 }
        );
        assert_eq!(
            acquire_watch(Some((1, false)), false),
            WatchAcquire::Reuse { refcount: 2 }
        );
        assert_eq!(
            acquire_watch(Some((2, true)), true),
            WatchAcquire::Reuse { refcount: 3 }
        );
    }

    #[test]
    fn mode_change_restarts_session_and_resets_refcount() {
        assert_eq!(
            acquire_watch(Some((1, true)), false),
            WatchAcquire::Restart { refcount: 1 }
        );
        assert_eq!(
            acquire_watch(Some((4, false)), true),
            WatchAcquire::Restart { refcount: 1 }
        );
    }

    #[test]
    fn maps_nested_file_to_parent_directory() {
        let burst = ingest_path(EventKind::Create(CreateKind::File), "src/main.rs");
        assert!(burst.directories.contains("src"));
        assert_eq!(burst.directories.len(), 1);
    }

    #[test]
    fn maps_root_file_to_dot() {
        let burst = ingest_path(EventKind::Remove(RemoveKind::File), "README.md");
        assert!(burst.directories.contains("."));
    }

    #[test]
    fn maps_created_directory_to_its_parent() {
        let burst = ingest_path(EventKind::Create(CreateKind::Folder), "src/lib");
        assert!(burst.directories.contains("src"));
        assert!(!burst.directories.contains("src/lib"));
    }

    #[test]
    fn maps_rename_from_and_to_parents() {
        let mut burst = Burst::default();
        ingest(
            &root(),
            WatchInput::Event(
                Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
                    .add_path(join("src/old.rs"))
                    .add_path(join("lib/new.rs")),
            ),
            &mut burst,
        );
        assert!(burst.directories.contains("src"));
        assert!(burst.directories.contains("lib"));
    }

    #[test]
    fn excludes_changes_inside_skip_dirs() {
        let burst = ingest_path(
            EventKind::Create(CreateKind::File),
            "node_modules/pkg/index.js",
        );
        assert!(burst.directories.is_empty());
    }

    #[test]
    fn still_emits_parent_when_skip_dir_itself_appears() {
        let burst = ingest_path(EventKind::Create(CreateKind::Folder), "node_modules");
        assert!(burst.directories.contains("."));
    }

    #[test]
    fn excludes_hidden_dirs_but_keeps_github() {
        let vscode = ingest_path(EventKind::Create(CreateKind::File), ".vscode/settings.json");
        assert!(vscode.directories.is_empty());

        let github = ingest_path(
            EventKind::Create(CreateKind::File),
            ".github/workflows/ci.yml",
        );
        assert!(github.directories.contains(".github/workflows"));
    }

    #[test]
    fn treats_any_and_modify_any_as_structural() {
        let any = ingest_path(EventKind::Any, "src/main.rs");
        assert!(any.directories.contains("src"));
        assert_eq!(any.directories.len(), 1);
        assert_eq!(any.new_dirs, vec![join("src/main.rs")]);

        let modify_any = ingest_path(EventKind::Modify(ModifyKind::Any), "src/lib.rs");
        assert!(modify_any.directories.contains("src"));
        assert_eq!(modify_any.directories.len(), 1);
        assert_eq!(modify_any.new_dirs, vec![join("src/lib.rs")]);
    }

    #[test]
    fn ignores_data_and_metadata_modifies() {
        let data = ingest_path(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            "src/main.rs",
        );
        assert!(data.directories.is_empty());
        assert!(data.new_dirs.is_empty());

        let meta = ingest_path(
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime)),
            "src/main.rs",
        );
        assert!(meta.directories.is_empty());
        assert!(meta.new_dirs.is_empty());

        let access = ingest_path(EventKind::Access(AccessKind::Any), "src/main.rs");
        assert!(access.directories.is_empty());
        assert!(access.new_dirs.is_empty());
    }

    #[test]
    fn burst_over_parent_cap_collapses_to_rescan() {
        let mut directories = HashSet::new();
        for index in 0..MAX_PARENTS {
            directories.insert(format!("dir-{index}"));
        }
        let kept =
            finalize_burst("/workspace", directories.clone(), false, false).expect("payload");
        assert!(!kept.rescan);
        assert_eq!(kept.directories.len(), MAX_PARENTS);

        directories.insert("dir-extra".to_string());
        let collapsed = finalize_burst("/workspace", directories, false, false).expect("payload");
        assert!(collapsed.rescan);
        assert!(collapsed.directories.is_empty());
        assert_eq!(collapsed.root_path, "/workspace");
    }

    #[test]
    fn cap_hit_collapses_to_rescan() {
        let mut directories = HashSet::new();
        directories.insert("src".to_string());
        let payload = finalize_burst("/workspace", directories, false, true).expect("payload");
        assert!(payload.rescan);
        assert!(payload.directories.is_empty());
    }

    #[test]
    fn need_rescan_skips_path_filtering() {
        let mut burst = Burst::default();
        ingest(
            &root(),
            WatchInput::Event(
                Event::new(EventKind::Create(CreateKind::File))
                    .add_path(join("src/main.rs"))
                    .set_flag(Flag::Rescan),
            ),
            &mut burst,
        );
        assert!(burst.rescan);
        assert!(burst.directories.is_empty());
    }

    #[test]
    fn watcher_error_sets_rescan() {
        let mut burst = Burst::default();
        ingest(&root(), WatchInput::Error, &mut burst);
        assert!(burst.rescan);
        let payload =
            finalize_burst("/workspace", burst.directories, burst.rescan, false).expect("payload");
        assert!(payload.rescan);
        assert!(payload.directories.is_empty());
    }

    #[test]
    fn collect_watchable_dirs_skips_high_churn() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src/nested")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::create_dir_all(dir.path().join(".github/workflows")).unwrap();

        let (watched, truncated) = collect_watchable_dirs(dir.path(), MAX_WATCHES);
        assert!(!truncated);
        let relatives: HashSet<String> = watched
            .into_iter()
            .filter_map(|path| path.strip_prefix(dir.path()).ok().map(normalize_rel))
            .collect();

        assert!(relatives.contains("."));
        assert!(relatives.contains("src"));
        assert!(relatives.contains("src/nested"));
        assert!(relatives.contains(".github"));
        assert!(relatives.contains(".github/workflows"));
        assert!(!relatives.contains("node_modules"));
        assert!(!relatives.contains("node_modules/pkg"));
        assert!(!relatives.contains(".git"));
    }

    #[test]
    fn notify_create_maps_to_parent_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().canonicalize().expect("canonicalize");
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                let _ = tx.send(result);
            },
            Config::default(),
        )
        .expect("watcher");
        watcher
            .watch(&root, RecursiveMode::NonRecursive)
            .expect("watch");

        fs::write(root.join("created.txt"), "ok").expect("write");

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut burst = Burst::default();
        while Instant::now() < deadline {
            if let Ok(result) = rx.recv_timeout(Duration::from_millis(200)) {
                let input = match result {
                    Ok(event) => WatchInput::Event(event),
                    Err(_) => WatchInput::Error,
                };
                ingest(&root, input, &mut burst);
                if burst.rescan || burst.directories.contains(".") {
                    break;
                }
            }
        }

        assert!(
            burst.rescan || burst.directories.contains("."),
            "expected a structural create under the temp root, got {:?}",
            burst.directories
        );
    }

    #[test]
    fn unwatch_key_matches_canonical_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let canonical = dir
            .path()
            .canonicalize()
            .expect("canonicalize")
            .to_string_lossy()
            .to_string();
        let known = HashSet::from([canonical.clone()]);
        assert_eq!(
            unwatch_session_key(&canonical, |candidate| known.contains(candidate)),
            Some(canonical)
        );
    }

    #[test]
    fn unwatch_key_resolves_alias_to_canonical_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("nested");
        fs::create_dir(&nested).expect("nested dir");
        let canonical = dir
            .path()
            .canonicalize()
            .expect("canonicalize")
            .to_string_lossy()
            .to_string();
        let known = HashSet::from([canonical.clone()]);

        let dotted = nested.join("..");
        let dotted_str = dotted.to_string_lossy().to_string();
        assert_eq!(
            unwatch_session_key(&dotted_str, |candidate| known.contains(candidate)),
            Some(canonical.clone())
        );

        #[cfg(unix)]
        {
            let alias = dir.path().join("alias");
            std::os::unix::fs::symlink(dir.path(), &alias).expect("symlink");
            let alias_str = alias.to_string_lossy().to_string();
            assert_eq!(
                unwatch_session_key(&alias_str, |candidate| known.contains(candidate)),
                Some(canonical)
            );
        }
    }

    #[test]
    fn unwatch_deleted_root_does_not_leak() {
        let dir = tempfile::tempdir().expect("tempdir");
        let canonical = dir
            .path()
            .canonicalize()
            .expect("canonicalize")
            .to_string_lossy()
            .to_string();
        let mut known = HashSet::from([canonical.clone()]);
        drop(dir);

        assert!(canonical_project_root(&canonical).is_err());
        let key = unwatch_session_key(&canonical, |candidate| known.contains(candidate))
            .expect("deleted root still looks up the stored canonical key");
        known.remove(&key);
        assert!(known.is_empty());

        let missing = format!("{canonical}-missing");
        let leftover = HashSet::from([canonical.clone()]);
        assert_eq!(
            unwatch_session_key(&missing, |candidate| leftover.contains(candidate)),
            None
        );
        assert!(leftover.contains(&canonical));
    }

    fn recording_replace(
        watched: &mut HashSet<PathBuf>,
        target: &HashSet<PathBuf>,
        fail: &HashSet<PathBuf>,
    ) -> (Result<(), String>, Vec<PathBuf>, Vec<PathBuf>) {
        let mut watch_calls = Vec::new();
        let mut unwatch_calls = Vec::new();
        let result = apply_watch_replace(watched, target, |op| match op {
            ReplaceOp::Watch(path) => {
                watch_calls.push(path.to_path_buf());
                if fail.contains(path) {
                    Err("watch failed".to_string())
                } else {
                    Ok(())
                }
            }
            ReplaceOp::Unwatch(path) => {
                unwatch_calls.push(path.to_path_buf());
                Ok(())
            }
        });
        (result, watch_calls, unwatch_calls)
    }

    #[test]
    fn failed_watch_does_not_drain_old_watches() {
        let kept = PathBuf::from("/workspace/src");
        let stale = PathBuf::from("/workspace/old");
        let incoming = PathBuf::from("/workspace/new");
        let mut watched = HashSet::from([kept.clone(), stale.clone()]);
        let target = HashSet::from([incoming.clone()]);
        let fail = HashSet::from([incoming.clone()]);

        let (result, watch_calls, unwatch_calls) = recording_replace(&mut watched, &target, &fail);

        assert!(result.is_ok());
        assert!(watched.contains(&kept));
        assert!(watched.contains(&stale));
        assert!(!watched.contains(&incoming));
        assert_eq!(watch_calls, vec![incoming]);
        assert!(unwatch_calls.is_empty());
    }

    #[test]
    fn overlapping_paths_are_not_rewatched_or_unwatched() {
        let overlap = PathBuf::from("/workspace/src");
        let stale = PathBuf::from("/workspace/old");
        let incoming = PathBuf::from("/workspace/lib");
        let mut watched = HashSet::from([overlap.clone(), stale.clone()]);
        let target = HashSet::from([overlap.clone(), incoming.clone()]);
        let fail = HashSet::new();

        let (result, watch_calls, unwatch_calls) = recording_replace(&mut watched, &target, &fail);

        assert!(result.is_ok());
        assert_eq!(watched, HashSet::from([overlap.clone(), incoming.clone()]));
        assert_eq!(watch_calls, vec![incoming]);
        assert_eq!(unwatch_calls, vec![stale]);
        assert!(!watch_calls.contains(&overlap));
        assert!(!unwatch_calls.contains(&overlap));
    }
}
