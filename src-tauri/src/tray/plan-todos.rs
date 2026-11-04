use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const PLAN_READ_LIMIT: u64 = 1024 * 1024;

pub(crate) fn is_todo_status(status: &str) -> bool {
    matches!(
        status,
        "pending" | "in_progress" | "completed" | "cancelled"
    )
}

pub(crate) fn parse_plan_statuses(content: &str) -> Option<Vec<String>> {
    let yaml = frontmatter(content)?;
    todos_from_yaml(&yaml)
}

pub(crate) fn read_plan_statuses(project_root: &str, plan_path: &str) -> Option<Vec<String>> {
    let path = resolve_plan_file(project_root, plan_path)?;
    let content = read_limited(&path)?;
    parse_plan_statuses(&content)
}

fn resolve_plan_file(project_root: &str, plan_path: &str) -> Option<PathBuf> {
    if project_root.contains('\0') || plan_path.contains('\0') {
        return None;
    }
    if crate::commands::ssh::is_ssh_root(project_root) {
        return None;
    }

    let root = Path::new(project_root.trim());
    let plan = Path::new(plan_path.trim());
    if plan.as_os_str().is_empty() {
        return None;
    }

    let root_canon = root.canonicalize().ok()?;
    if plan.is_absolute() {
        if has_parent_dir(plan) {
            return None;
        }
        let plan_canon = plan.canonicalize().ok()?;
        if !plan_canon.starts_with(&root_canon) {
            return None;
        }
        return Some(plan_canon);
    }
    if has_parent_dir(plan) {
        return None;
    }

    let plan_canon = root_canon.join(plan).canonicalize().ok()?;
    if !plan_canon.starts_with(&root_canon) {
        return None;
    }
    Some(plan_canon)
}

fn has_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn read_limited(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = file.take(PLAN_READ_LIMIT);
    let mut content = String::new();
    reader.read_to_string(&mut content).ok()?;
    Some(content)
}

fn frontmatter(content: &str) -> Option<String> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let rest = content
        .strip_prefix("---\r\n")
        .or_else(|| content.strip_prefix("---\n"))?;
    let mut yaml = String::new();
    for line in rest.split('\n') {
        let line = line.trim_end_matches('\r');
        if line == "---" {
            return Some(yaml);
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    None
}

fn todos_from_yaml(yaml: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = yaml.split('\n').collect();
    for (index, line) in lines.iter().enumerate() {
        let Some(rest) = line.strip_prefix("todos:") else {
            continue;
        };
        let inline = rest.trim();
        if inline == "[]" {
            return Some(Vec::new());
        }
        if !inline.is_empty() {
            return None;
        }
        return todo_items(&lines[index + 1..]);
    }
    None
}

struct TodoItem {
    id: Option<String>,
    content: Option<String>,
    status: Option<String>,
}

fn todo_items(lines: &[&str]) -> Option<Vec<String>> {
    let mut statuses = Vec::new();
    let mut current: Option<TodoItem> = None;
    let mut saw_item = false;
    for line in lines {
        if line.trim().is_empty() {
            break;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            break;
        }
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("- id:") {
            if let Some(item) = current.take() {
                statuses.push(finish_item(item)?);
            }
            saw_item = true;
            current = Some(TodoItem {
                id: Some(rest.trim().to_string()),
                content: None,
                status: None,
            });
            continue;
        }
        let item = current.as_mut()?;
        if let Some(rest) = trimmed.strip_prefix("content:") {
            if item.content.is_some() {
                return None;
            }
            item.content = Some(rest.trim().to_string());
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("status:") {
            if item.status.is_some() {
                return None;
            }
            let status = unquote(rest.trim());
            if !is_todo_status(status) {
                return None;
            }
            item.status = Some(status.to_string());
            continue;
        }
        return None;
    }
    if let Some(item) = current {
        statuses.push(finish_item(item)?);
    }
    if !saw_item {
        None
    } else {
        Some(statuses)
    }
}

fn finish_item(item: TodoItem) -> Option<String> {
    let id = item.id?;
    if id.is_empty() || item.content.is_none() {
        return None;
    }
    item.status
}

fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let quote = bytes[0];
        if (quote == b'"' || quote == b'\'') && bytes[bytes.len() - 1] == quote {
            return &value[1..value.len() - 1];
        }
    }
    value
}
