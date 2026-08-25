use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::AppHandle;

use super::paths::graph_store_dir;

const GRAPH_ID_LEN: usize = 64;

/// Resolve `{store_root}/{id}` only when `id` is a hex graph id with no path escape.
pub fn resolve_graph_delete_dir(store_root: &Path, id: &str) -> Result<PathBuf, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("id is required".to_string());
    }
    if trimmed.contains('\0') {
        return Err("id must not contain NUL bytes".to_string());
    }
    if Path::new(trimmed).is_absolute() {
        return Err("id must not be an absolute path".to_string());
    }
    let path = Path::new(trimmed);
    if path.components().count() != 1 {
        return Err("id must not contain path separators".to_string());
    }
    match path.components().next() {
        Some(Component::Normal(part)) => {
            let name = part.to_string_lossy();
            if name.contains("..") {
                return Err("id must not contain '..'".to_string());
            }
            if name.len() != GRAPH_ID_LEN || !name.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err("id must be a 64-character hex graph id".to_string());
            }
        }
        _ => return Err("Invalid graph id".to_string()),
    }
    let candidate = store_root.join(trimmed);
    if !candidate.starts_with(store_root) {
        return Err("Graph path escapes store".to_string());
    }
    Ok(candidate)
}

#[tauri::command]
pub fn delete_graph(app: AppHandle, id: String) -> Result<(), String> {
    let store_root = graph_store_dir(&app)?;
    let graph_dir = resolve_graph_delete_dir(&store_root, &id)?;
    if !graph_dir.exists() {
        return Err("Graph not found".to_string());
    }
    if !graph_dir.is_dir() {
        return Err("Graph path is not a directory".to_string());
    }
    fs::remove_dir_all(&graph_dir).map_err(|error| format!("Failed to delete graph: {error}"))?;
    Ok(())
}
