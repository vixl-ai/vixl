use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// `None` keeps the stored value. `Some(None)` clears it. `Some(Some(value))` sets it.
#[derive(Debug, Clone, Default)]
pub struct LspStatePatch {
    pub message: Option<Option<String>>,
    pub error: Option<Option<String>>,
    pub activity: Option<Option<LspActivity>>,
    pub source: Option<Option<String>>,
    pub workspace_root: Option<Option<String>>,
    pub pid: Option<Option<u32>>,
}

impl LspStatePatch {
    /// Applies `error` (`None` clears) and sets `source` only when it is `Some`.
    pub fn from_error_source(error: Option<String>, source: Option<String>) -> Self {
        Self {
            error: Some(error),
            activity: Some(None),
            source: source.map(Some),
            ..Self::default()
        }
    }

    pub fn starting(source: String, workspace_root: String, message: Option<String>) -> Self {
        Self {
            message: Some(message),
            error: Some(None),
            activity: Some(None),
            source: Some(Some(source)),
            workspace_root: Some(Some(workspace_root)),
            pid: Some(None),
        }
    }

    pub fn running(source: String, workspace_root: String, pid: Option<u32>) -> Self {
        Self {
            message: Some(None),
            error: Some(None),
            source: Some(Some(source)),
            workspace_root: Some(Some(workspace_root)),
            pid: Some(pid),
            ..Self::default()
        }
    }

    /// Clears progress text, activity, and pid. `error: None` clears a previous error.
    pub fn terminal(error: Option<String>) -> Self {
        Self {
            message: Some(None),
            error: Some(error),
            activity: Some(None),
            pid: Some(None),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LspPhase {
    Missing,
    Idle,
    NeedsTrust,
    Installing,
    Starting,
    Running,
    Stopping,
    Stopped,
    Exited,
    Crashed,
    Error,
}

impl LspPhase {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Idle => "idle",
            Self::NeedsTrust => "needs_trust",
            Self::Installing => "installing",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Stopping => "stopping",
            Self::Stopped => "stopped",
            Self::Exited => "exited",
            Self::Crashed => "crashed",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspActivity {
    pub token: Option<String>,
    pub title: String,
    pub message: Option<String>,
    pub percentage: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerState {
    pub id: String,
    pub phase: LspPhase,
    pub generation: u64,
    pub revision: u64,
    pub phase_since_ms: u64,
    pub message: Option<String>,
    pub error: Option<String>,
    pub activity: Option<LspActivity>,
    pub source: Option<String>,
    pub workspace_root: Option<String>,
    pub pid: Option<u32>,
    /// Derived at write time: `phase == Running`.
    pub running: bool,
}

struct LspRuntime {
    states: HashMap<String, LspServerState>,
    /// Per-server generation. Bumped by `next_generation`, not by a state write.
    generations: HashMap<String, u64>,
}

lazy_static::lazy_static! {
    static ref RUNTIME: Mutex<LspRuntime> = Mutex::new(LspRuntime {
        states: HashMap::new(),
        generations: HashMap::new(),
    });
}

static REVISION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// A state value that was not written through `transition`, so `revision` stays 0.
pub(crate) fn ephemeral_state(
    id: impl Into<String>,
    phase: LspPhase,
    generation: u64,
    error: Option<String>,
    source: Option<String>,
) -> LspServerState {
    LspServerState {
        id: id.into(),
        phase,
        generation,
        revision: 0,
        phase_since_ms: now_ms(),
        message: None,
        error,
        activity: None,
        source,
        workspace_root: None,
        pid: None,
        running: phase == LspPhase::Running,
    }
}

pub(crate) fn fallback_server_state(id: &str, installed: bool, source: String) -> LspServerState {
    let phase = if installed {
        LspPhase::Idle
    } else {
        LspPhase::Missing
    };
    LspServerState {
        id: id.to_string(),
        phase,
        generation: 0,
        revision: 0,
        phase_since_ms: 0,
        message: None,
        error: None,
        activity: None,
        source: Some(source),
        workspace_root: None,
        pid: None,
        running: false,
    }
}

pub(crate) async fn next_generation(id: &str) -> u64 {
    let mut runtime = RUNTIME.lock().await;
    let generation = runtime.generations.entry(id.to_string()).or_insert(0);
    *generation += 1;
    *generation
}

pub(crate) async fn current_generation(id: &str) -> u64 {
    RUNTIME
        .lock()
        .await
        .generations
        .get(id)
        .copied()
        .unwrap_or(0)
}

pub(crate) async fn snapshot(id: &str) -> Option<LspServerState> {
    RUNTIME.lock().await.states.get(id).cloned()
}

pub(crate) async fn all_states() -> Vec<LspServerState> {
    let runtime = RUNTIME.lock().await;
    let mut states: Vec<_> = runtime.states.values().cloned().collect();
    states.sort_by(|left, right| left.id.cmp(&right.id));
    states
}

/// One attempted write. `now_ms` is used only when `phase` changes.
pub struct LspStateWrite<'a> {
    pub id: &'a str,
    pub generation: u64,
    pub phase: LspPhase,
    pub patch: LspStatePatch,
    pub now_ms: u64,
}

/// Applies one state write to `states`.
///
/// Returns `None` when `generation` is lower than `current_generation`.
/// A `Running` write also returns `None` when the stored phase at that same
/// generation is `Stopping`, `Stopped`, `Exited`, `Crashed`, or `Error`.
/// `phase_since_ms` changes only when `phase` changes. `running` is `phase == Running`.
pub fn apply_transition(
    states: &mut HashMap<String, LspServerState>,
    current_generation: u64,
    revision: &AtomicU64,
    write: LspStateWrite<'_>,
) -> Option<LspServerState> {
    if write.generation < current_generation {
        return None;
    }

    let existing = states.get(write.id).cloned();
    if same_generation_running_blocked(existing.as_ref(), write.phase, write.generation) {
        return None;
    }
    let phase_since_ms = match existing.as_ref() {
        Some(state) if state.phase == write.phase => state.phase_since_ms,
        _ => write.now_ms,
    };
    let next_revision = revision.fetch_add(1, Ordering::Relaxed) + 1;
    let state = LspServerState {
        id: write.id.to_string(),
        phase: write.phase,
        generation: write.generation,
        revision: next_revision,
        phase_since_ms,
        message: merge_field(
            write.patch.message,
            existing.as_ref().and_then(|state| state.message.clone()),
        ),
        error: merge_field(
            write.patch.error,
            existing.as_ref().and_then(|state| state.error.clone()),
        ),
        activity: merge_field(
            write.patch.activity,
            existing.as_ref().and_then(|state| state.activity.clone()),
        ),
        source: merge_field(
            write.patch.source,
            existing.as_ref().and_then(|state| state.source.clone()),
        ),
        workspace_root: merge_field(
            write.patch.workspace_root,
            existing
                .as_ref()
                .and_then(|state| state.workspace_root.clone()),
        ),
        pid: merge_field(
            write.patch.pid,
            existing.as_ref().and_then(|state| state.pid),
        ),
        running: write.phase == LspPhase::Running,
    };
    states.insert(write.id.to_string(), state.clone());
    Some(state)
}

fn same_generation_running_blocked(
    existing: Option<&LspServerState>,
    phase: LspPhase,
    generation: u64,
) -> bool {
    let Some(existing) = existing else {
        return false;
    };
    phase == LspPhase::Running
        && existing.generation == generation
        && matches!(
            existing.phase,
            LspPhase::Stopping
                | LspPhase::Stopped
                | LspPhase::Exited
                | LspPhase::Crashed
                | LspPhase::Error
        )
}

fn merge_field<T>(patch: Option<Option<T>>, existing: Option<T>) -> Option<T> {
    match patch {
        None => existing,
        Some(value) => value,
    }
}

pub(crate) async fn transition(
    app: &AppHandle,
    id: &str,
    generation: u64,
    phase: LspPhase,
    patch: LspStatePatch,
) -> Option<LspServerState> {
    transition_with(app, id, generation, move |_existing| Some((phase, patch))).await
}

/// `decide` runs while the state map is locked. It must not await or lock a process.
/// `None` skips the write.
pub(crate) async fn transition_with(
    app: &AppHandle,
    id: &str,
    generation: u64,
    decide: impl FnOnce(Option<&LspServerState>) -> Option<(LspPhase, LspStatePatch)>,
) -> Option<LspServerState> {
    let state = {
        let mut runtime = RUNTIME.lock().await;
        let current = runtime.generations.get(id).copied().unwrap_or(0);
        let decided = decide(runtime.states.get(id));
        let (phase, patch) = decided?;
        apply_transition(
            &mut runtime.states,
            current,
            &REVISION,
            LspStateWrite {
                id,
                generation,
                phase,
                patch,
                now_ms: now_ms(),
            },
        )
    };
    if let Some(state) = state.as_ref() {
        let _ = app.emit("lsp://state", state.clone());
    }
    state
}
