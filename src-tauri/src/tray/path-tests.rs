use std::path::Path;

use super::plan_todos::parse_plan_statuses;
use super::summary::{resolve_agent_progress, TodoProgress};

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
fn malformed_plan_falls_back_to_inline() {
    let root = tempfile::tempdir().unwrap();
    let bogus = "not a plan\ntodos:\n  - id: a\n    content: \"x\"\n    status: completed\n";
    write_plan(root.path(), "PLAN.md", bogus);
    let inline = vec![todo_event(&[("a", "pending"), ("b", "pending")])];
    let progress = resolve_agent_progress(root.path().to_str().unwrap(), Some("PLAN.md"), &inline);
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 0,
            total: 2
        })
    );
    assert!(parse_plan_statuses(bogus).is_none());
}

#[test]
fn absolute_plan_outside_root_falls_back_to_inline() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let outside_plan = write_plan(
        outside.path(),
        "PLAN.md",
        &plan_document(
            "todos:\n  - id: a\n    content: \"x\"\n    status: completed\n  - id: b\n    content: \"y\"\n    status: completed\n",
        ),
    );
    let inline = vec![todo_event(&[("a", "pending")])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some(outside_plan.to_str().unwrap()),
        &inline,
    );
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 0,
            total: 1
        })
    );
}

#[test]
fn absolute_plan_inside_root_is_used() {
    let root = tempfile::tempdir().unwrap();
    let plan = write_plan(
        root.path(),
        "PLAN.md",
        &plan_document(
            "todos:\n  - id: a\n    content: \"x\"\n    status: completed\n  - id: b\n    content: \"y\"\n    status: pending\n",
        ),
    );
    let inline = vec![todo_event(&[("z", "completed")])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some(plan.to_str().unwrap()),
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
fn parent_traversal_falls_back_to_inline() {
    let root = tempfile::tempdir().unwrap();
    write_plan(
        root.path(),
        "PLAN.md",
        &plan_document(
            "todos:\n  - id: a\n    content: \"x\"\n    status: completed\n  - id: b\n    content: \"y\"\n    status: completed\n",
        ),
    );
    std::fs::create_dir_all(root.path().join("nested")).unwrap();
    let inline = vec![todo_event(&[
        ("a", "pending"),
        ("b", "pending"),
        ("c", "completed"),
    ])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some("nested/../PLAN.md"),
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
fn unreadable_plan_falls_back_to_inline() {
    let root = tempfile::tempdir().unwrap();
    let inline = vec![todo_event(&[("a", "completed"), ("b", "in_progress")])];
    let progress = resolve_agent_progress(
        root.path().to_str().unwrap(),
        Some("missing/PLAN.md"),
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
fn ssh_root_skips_plan_file() {
    let root = tempfile::tempdir().unwrap();
    let plan = write_plan(
        root.path(),
        "PLAN.md",
        &plan_document("todos:\n  - id: a\n    content: \"x\"\n    status: completed\n"),
    );
    let inline = vec![todo_event(&[("a", "pending")])];
    let progress = resolve_agent_progress(
        "ssh://example/home/proj",
        Some(plan.to_str().unwrap()),
        &inline,
    );
    assert_eq!(
        progress,
        Some(TodoProgress {
            completed: 0,
            total: 1
        })
    );
}
