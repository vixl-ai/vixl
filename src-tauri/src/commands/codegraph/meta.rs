use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMeta {
    pub project_root: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn meta_path(graph_dir: &Path) -> std::path::PathBuf {
    graph_dir.join("meta.json")
}

pub fn read_graph_meta(graph_dir: &Path) -> Option<GraphMeta> {
    let raw = fs::read_to_string(meta_path(graph_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn upsert_graph_meta(graph_dir: &Path, canonical_root: &Path) -> Result<GraphMeta, String> {
    fs::create_dir_all(graph_dir)
        .map_err(|error| format!("Failed to create graph dir: {error}"))?;
    let now = chrono::Utc::now().to_rfc3339();
    let name = canonical_root
        .file_name()
        .map(|part| part.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "project".to_string());
    let project_root = canonical_root.to_string_lossy().to_string();
    let created_at = read_graph_meta(graph_dir)
        .map(|existing| existing.created_at)
        .unwrap_or_else(|| now.clone());
    let meta = GraphMeta {
        project_root,
        name,
        created_at,
        updated_at: now,
    };
    let json = serde_json::to_string_pretty(&meta)
        .map_err(|error| format!("Failed to serialize graph meta: {error}"))?;
    fs::write(meta_path(graph_dir), json)
        .map_err(|error| format!("Failed to write graph meta: {error}"))?;
    Ok(meta)
}
