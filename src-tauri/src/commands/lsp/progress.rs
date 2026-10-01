use std::collections::HashMap;

use super::state::{LspActivity, LspPhase, LspServerState, LspStatePatch};

pub const PROGRESS_REPORT_MIN_INTERVAL_MS: u64 = 250;
pub const PROJECT_LOAD_FUSE_MS: u64 = 20_000;

const LOADING_PROJECT_TITLE: &str = "Loading project";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressKind {
    Begin,
    Report,
    End,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgressUpdate {
    pub(crate) kind: ProgressKind,
    token: String,
    title: Option<String>,
    message: Option<Option<String>>,
    percentage: Option<Option<u32>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActiveProgress {
    activities: HashMap<String, LspActivity>,
    order: Vec<String>,
}

impl ActiveProgress {
    pub fn apply(&mut self, update: ProgressUpdate) {
        let token = update.token;
        match update.kind {
            ProgressKind::Begin => {
                self.activities.insert(
                    token.clone(),
                    LspActivity {
                        token: Some(token.clone()),
                        title: update.title.unwrap_or_default(),
                        message: update.message.flatten(),
                        percentage: update.percentage.flatten(),
                    },
                );
                self.note_latest(token);
            }
            ProgressKind::Report => {
                {
                    let Some(activity) = self.activities.get_mut(&token) else {
                        return;
                    };
                    if let Some(title) = update.title {
                        activity.title = title;
                    }
                    if let Some(message) = update.message {
                        activity.message = message;
                    }
                    if let Some(percentage) = update.percentage {
                        activity.percentage = percentage;
                    }
                }
                self.note_latest(token);
            }
            ProgressKind::End => {
                if self.activities.remove(&token).is_some() {
                    self.order.retain(|item| item != &token);
                }
            }
        }
    }

    pub fn current(&self) -> Option<&LspActivity> {
        self.order
            .last()
            .and_then(|token| self.activities.get(token))
    }

    fn note_latest(&mut self, token: String) {
        self.order.retain(|item| item != &token);
        self.order.push(token);
    }
}

pub fn parse_progress_params(params: &serde_json::Value) -> Option<ProgressUpdate> {
    let token = normalize_token(params.get("token")?)?;
    let value = params.get("value")?;
    let kind = match value.get("kind").and_then(|kind| kind.as_str())? {
        "begin" => ProgressKind::Begin,
        "report" => ProgressKind::Report,
        "end" => ProgressKind::End,
        _ => return None,
    };
    let title = match value.get("title") {
        Some(serde_json::Value::String(text)) => Some(text.clone()),
        _ => None,
    };
    let message = keep_clear_set_string(value.get("message"));
    let percentage = keep_clear_set_u32(value.get("percentage"));
    Some(ProgressUpdate {
        kind,
        token,
        title,
        message,
        percentage,
    })
}

pub fn should_emit_progress(kind: ProgressKind, now_ms: u64, last_emit_ms: Option<u64>) -> bool {
    match kind {
        ProgressKind::Begin | ProgressKind::End => true,
        ProgressKind::Report => match last_emit_ms {
            None => true,
            Some(last) => now_ms.saturating_sub(last) >= PROGRESS_REPORT_MIN_INTERVAL_MS,
        },
    }
}

pub fn server_awaits_project_load(server_id: &str) -> bool {
    matches!(server_id, "vue" | "typescript")
}

pub fn activity_for_running(
    progress: Option<LspActivity>,
    loading_pending: bool,
) -> Option<LspActivity> {
    if let Some(progress) = progress {
        return Some(progress);
    }
    loading_pending.then(loading_project_activity)
}

pub fn running_activity_decision(
    existing: Option<&LspServerState>,
    generation: u64,
    activity: Option<LspActivity>,
) -> Option<(LspPhase, LspStatePatch)> {
    let state = existing?;
    if state.phase != LspPhase::Running
        || state.generation != generation
        || state.activity == activity
    {
        return None;
    }
    Some((
        LspPhase::Running,
        LspStatePatch {
            activity: Some(activity),
            ..LspStatePatch::default()
        },
    ))
}

pub fn clear_loading_activity(
    existing: Option<&LspServerState>,
    generation: u64,
) -> Option<(LspPhase, LspStatePatch)> {
    let state = existing?;
    if !state.activity.as_ref().is_some_and(is_loading_project) {
        return None;
    }
    running_activity_decision(existing, generation, None)
}

fn loading_project_activity() -> LspActivity {
    LspActivity {
        token: None,
        title: LOADING_PROJECT_TITLE.to_string(),
        message: None,
        percentage: None,
    }
}

fn is_loading_project(activity: &LspActivity) -> bool {
    activity.token.is_none() && activity.title == LOADING_PROJECT_TITLE
}

fn normalize_token(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn keep_clear_set_string(value: Option<&serde_json::Value>) -> Option<Option<String>> {
    match value {
        None => None,
        Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(text)) => Some(Some(text.clone())),
        Some(_) => None,
    }
}

fn keep_clear_set_u32(value: Option<&serde_json::Value>) -> Option<Option<u32>> {
    match value {
        None => None,
        Some(serde_json::Value::Null) => Some(None),
        Some(value) => json_u32(value).map(Some),
    }
}

fn json_u32(value: &serde_json::Value) -> Option<u32> {
    value.as_u64().and_then(|number| u32::try_from(number).ok())
}
