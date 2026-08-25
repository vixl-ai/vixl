use std::fs;

use serde::Serialize;
use tauri::AppHandle;

use super::cli::validate_absolute_root;
use super::id::graph_id_for_root;
use super::meta::{read_graph_meta, upsert_graph_meta};
use super::paths::{graph_dir_for_root, GRAPH_DB_NAME};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodegraphStoreStat {
    pub store_dir: String,
    pub db_exists: bool,
    pub graph_id: String,
}

#[tauri::command]
pub fn codegraph_store_stat(
    app: AppHandle,
    project_root: String,
) -> Result<CodegraphStoreStat, String> {
    let root = validate_absolute_root(&project_root)?;
    let graph_dir = graph_dir_for_root(&app, &root)?;
    fs::create_dir_all(&graph_dir)
        .map_err(|error| format!("Failed to create graph dir: {error}"))?;
    if read_graph_meta(&graph_dir).is_none() {
        upsert_graph_meta(&graph_dir, &root)?;
    }
    let db_exists = graph_dir.join(GRAPH_DB_NAME).is_file();
    Ok(CodegraphStoreStat {
        store_dir: graph_dir.to_string_lossy().to_string(),
        db_exists,
        graph_id: graph_id_for_root(&root),
    })
}
