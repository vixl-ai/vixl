use std::path::Path;

use super::plan_todos::parse_plan_statuses;
use super::summary::{
    agent_menu_label, inline_todo_progress, progress_from_statuses, resolve_agent_progress,
    TodoProgress, MENU_TITLE_CHARS,
};

fn plan_document(todos: &str) -> String {
    format!(
        "---\nid: plan-1\ntitle: \"Demo\"\ncreatedAt: 2026-01-01T00:00:00Z\nmode: plan\n{todos}\n---\n\nBody\n"
    )
}

fn todo_event(items: &[(&str, &str)]) -> String {
    let todos: Vec<serde_json::Value> = items
        .iter()
        .map(|(id, status)| {
            serde_json::json!({
                "id": id,
                "content": id,
                "status": status,
            })
        })
        .collect();
    serde_json::json!({ "type": "todo-update", "todos": todos }).to_string()
}

fn write_plan(dir: &Path, relative: &str, content: &str) -> std::path::PathBuf {
    let path = dir.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&path, content).unwrap();
    path
}

#[test]
fn inline_todo_progress_counts_completed_over_total() {
    let newest = todo_event(&[
        ("a", "completed"),
        ("b", "completed"),
        ("c", "in_progress"),
        ("d", "pending"),
    ]);
    let older = todo_event(&[("old", "completed")]);
    let progress = inline_todo_progress(&[newest, older]).unwrap();
    assert_eq!(
        progress,
        TodoProgress {
            completed: 2,
            total: 4
        }
    );
}

#[test]
fn inline_todo_progress_excludes_cancelled() {
    let progress = progress_from_statuses(&["completed", "cancelled", "pending", "in_progress"]);
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 1,
            total: 3
        })
    );
    let event = todo_event(&[("a", "completed"), ("b", "cancelled"), ("c", "pending")]);
    assert_eq!(
        inline_todo_progress(&[event]),
        Some(TodoProgress {
            completed: 1,
            total: 2
        })
    );
}

#[test]
fn empty_inline_todo_list_is_not_progress() {
    let empty = r#"{"type":"todo-update","todos":[]}"#.to_string();
    let older = todo_event(&[("a", "completed")]);
    assert!(inline_todo_progress(&[empty, older]).is_none());
}

#[test]
fn malformed_harness_json_is_skipped() {
    let valid = todo_event(&[("a", "completed"), ("b", "pending")]);
    assert!(inline_todo_progress(&["{".to_string()]).is_none());
    assert_eq!(
        inline_todo_progress(&["{".to_string(), valid]),
        Some(TodoProgress {
            completed: 1,
            total: 2
        })
    );
}

#[test]
fn unusable_newest_todo_update_does_not_fall_back() {
    let older = todo_event(&[("a", "completed")]);
    let missing_todos = r#"{"type":"todo-update"}"#.to_string();
    let missing_status = r#"{"type":"todo-update","todos":[{"id":"a","content":"x"}]}"#.to_string();
    let invalid_status =
        r#"{"type":"todo-update","todos":[{"id":"a","content":"x","status":"blocked"}]}"#
            .to_string();
    let cancelled = todo_event(&[("a", "cancelled")]);
    assert!(inline_todo_progress(&[missing_todos, older.clone()]).is_none());
    assert!(inline_todo_progress(&[missing_status, older.clone()]).is_none());
    assert!(inline_todo_progress(&[invalid_status, older.clone()]).is_none());
    assert!(inline_todo_progress(&[cancelled, older]).is_none());
}

#[test]
fn plan_empty_todos_fall_back_to_inline() {
    let root = tempfile::tempdir().unwrap();
    let content = plan_document("todos: []");
    assert_eq!(parse_plan_statuses(&content).as_deref(), Some(&[][..]));
    let path = write_plan(root.path(), "PLAN.md", &content);
    let inline = vec![todo_event(&[("a", "completed"), ("b", "pending")])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some(path.file_name().unwrap().to_str().unwrap()),
        &inline,
    );
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 1,
            total: 2
        })
    );
}

#[test]
fn plan_block_todos_count_statuses() {
    let content = plan_document(
        "todos:\n  - id: a\n    content: \"one\"\n    status: completed\n  - id: b\n    content: \"two\"\n    status: pending\n",
    );
    assert_eq!(
        parse_plan_statuses(&content).as_deref(),
        Some(&["completed".to_string(), "pending".to_string()][..])
    );
}

#[test]
fn plan_mixed_statuses_exclude_cancelled() {
    let root = tempfile::tempdir().unwrap();
    let content = plan_document(
        "todos:\n  - id: a\n    content: \"one\"\n    status: completed\n  - id: b\n    content: \"two\"\n    status: in_progress\n  - id: c\n    content: \"three\"\n    status: pending\n  - id: d\n    content: \"four\"\n    status: cancelled\n",
    );
    write_plan(root.path(), ".vixl/plans/demo/PLAN.md", &content);
    let inline = vec![todo_event(&[("stale", "completed")])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some(".vixl/plans/demo/PLAN.md"),
        &inline,
    );
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 1,
            total: 3
        })
    );
}

#[test]
fn quoted_plan_content_keeps_following_status() {
    let content = plan_document(
        "todos:\n  - id: a\n    content: \"status: completed\"\n    status: pending\n",
    );
    assert_eq!(
        parse_plan_statuses(&content).as_deref(),
        Some(&["pending".to_string()][..])
    );
    let quoted = plan_document(
        "todos:\n  - id: b\n    content: \"say \\\"hi\\\": then: go\"\n    status: completed\n",
    );
    assert_eq!(
        parse_plan_statuses(&quoted).as_deref(),
        Some(&["completed".to_string()][..])
    );
}

#[test]
fn menu_label_is_ascii_and_truncated() {
    let long = "a".repeat(MENU_TITLE_CHARS + 10);
    let label = agent_menu_label(&long, None);
    assert_eq!(label.chars().count(), MENU_TITLE_CHARS);
    assert!(label.ends_with("..."));
    let with_progress = agent_menu_label(
        &long,
        Some(TodoProgress {
            completed: 1,
            total: 2,
        }),
    );
    assert!(with_progress.ends_with(" (1/2)"));
    assert_eq!(agent_menu_label("A & B", None), "A && B");
    assert_eq!(agent_menu_label("Caf\u{00e9} chat", None), "Caf chat");
}
