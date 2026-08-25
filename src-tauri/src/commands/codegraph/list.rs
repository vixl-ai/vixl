use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;

use super::meta::read_graph_meta;
use super::paths::{dir_size, graph_store_dir};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphListItem {
    pub id: String,
    pub name: String,
    pub project_root: String,
    pub store_dir: String,
    pub bytes: u64,
    pub missing: bool,
}

#[tauri::command]
pub fn list_graphs(app: AppHandle) -> Result<Vec<GraphListItem>, String> {
    let store_root = graph_store_dir(&app)?;
    let mut items = Vec::new();
    let entries =
        fs::read_dir(&store_root).map_err(|error| format!("Failed to list graphs: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to list graphs: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let meta = read_graph_meta(&path);
        let project_root = meta
            .as_ref()
            .map(|item| item.project_root.clone())
            .unwrap_or_default();
        let name = meta
            .as_ref()
            .map(|item| item.name.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| id.clone());
        let missing = project_root.is_empty() || !Path::new(&project_root).is_dir();
        items.push(GraphListItem {
            id,
            name,
            project_root,
            store_dir: path.to_string_lossy().to_string(),
            bytes: dir_size(&path),
            missing,
        });
    }
    items.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
    });
    Ok(items)
}
