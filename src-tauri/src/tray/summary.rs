use super::plan_todos::{self, is_todo_status};

pub(crate) const HARNESS_EVENT_SCAN_LIMIT: i64 = 256;
pub(crate) const MENU_TITLE_CHARS: usize = 48;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TodoProgress {
    pub completed: u32,
    pub total: u32,
}

pub(crate) struct TrayAgentRow {
    pub chat_id: String,
    pub project_slug: String,
    pub title: String,
    pub progress: Option<TodoProgress>,
}

pub(crate) struct TraySnapshot {
    pub agents: Vec<TrayAgentRow>,
    pub overflow: u32,
}

pub(crate) fn resolve_agent_progress(
    project_root: &str,
    active_plan_path: Option<&str>,
    harness_events_newest_first: &[String],
) -> Option<TodoProgress> {
    if let Some(plan_path) = active_plan_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        if let Some(statuses) = plan_todos::read_plan_statuses(project_root, plan_path) {
            if !statuses.is_empty() {
                return progress_from_statuses(&statuses);
            }
        }
    }
    inline_todo_progress(harness_events_newest_first)
}

pub(crate) fn progress_from_statuses<S: AsRef<str>>(statuses: &[S]) -> Option<TodoProgress> {
    let mut completed = 0u32;
    let mut total = 0u32;
    for status in statuses {
        match status.as_ref() {
            "cancelled" => {}
            "completed" => {
                total += 1;
                completed += 1;
            }
            "pending" | "in_progress" => total += 1,
            _ => {}
        }
    }
    if total == 0 {
        None
    } else {
        Some(TodoProgress { completed, total })
    }
}

pub(crate) fn inline_todo_progress(events_newest_first: &[String]) -> Option<TodoProgress> {
    for raw in events_newest_first {
        match classify_harness_event(raw) {
            InlineHit::Skip => continue,
            InlineHit::Stop => return None,
            InlineHit::Progress(progress) => return Some(progress),
        }
    }
    None
}

pub(crate) fn agent_menu_label(title: &str, progress: Option<TodoProgress>) -> String {
    let mut cleaned = String::new();
    let mut pending_space = false;
    for ch in title.chars() {
        if ch.is_ascii_graphic() {
            if pending_space && !cleaned.is_empty() {
                cleaned.push(' ');
            }
            pending_space = false;
            cleaned.push(ch);
        } else {
            pending_space = true;
        }
    }
    if cleaned.chars().count() > MENU_TITLE_CHARS {
        let keep = MENU_TITLE_CHARS.saturating_sub(3);
        let mut truncated: String = cleaned.chars().take(keep).collect();
        truncated.push_str("...");
        cleaned = truncated;
    }
    let cleaned = cleaned.replace('&', "&&");
    let title = if cleaned.is_empty() {
        "Untitled".to_string()
    } else {
        cleaned
    };
    match progress {
        Some(progress) => format!("{title} ({}/{})", progress.completed, progress.total),
        None => title,
    }
}

enum InlineHit {
    Skip,
    Stop,
    Progress(TodoProgress),
}

fn classify_harness_event(raw: &str) -> InlineHit {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return InlineHit::Skip;
    };
    if value.get("type").and_then(|kind| kind.as_str()) != Some("todo-update") {
        return InlineHit::Skip;
    }
    let Some(todos) = value.get("todos").and_then(|todos| todos.as_array()) else {
        return InlineHit::Stop;
    };
    if todos.is_empty() {
        return InlineHit::Stop;
    }
    let mut statuses = Vec::with_capacity(todos.len());
    for todo in todos {
        let Some(status) = todo.get("status").and_then(|status| status.as_str()) else {
            return InlineHit::Stop;
        };
        if !is_todo_status(status) {
            return InlineHit::Stop;
        }
        statuses.push(status.to_string());
    }
    match progress_from_statuses(&statuses) {
        Some(progress) => InlineHit::Progress(progress),
        None => InlineHit::Stop,
    }
}
