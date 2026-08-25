use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::id::graph_id_for_root;
use super::meta::upsert_graph_meta;
use super::paths::{graph_dir_for_root, graph_store_dir, preload_path};
use super::preload::ensure_preload_file;

pub struct PreparedCodegraphStore {
    pub graph_dir: PathBuf,
    pub preload_path: PathBuf,
    pub graph_id: String,
}

pub fn prepare_codegraph_store(
    app: &AppHandle,
    canonical_root: &Path,
) -> Result<PreparedCodegraphStore, String> {
    let store_root = graph_store_dir(app)?;
    ensure_preload_file(&store_root)?;
    let graph_dir = graph_dir_for_root(app, canonical_root)?;
    std::fs::create_dir_all(&graph_dir)
        .map_err(|error| format!("Failed to create graph dir: {error}"))?;
    upsert_graph_meta(&graph_dir, canonical_root)?;
    Ok(PreparedCodegraphStore {
        graph_id: graph_id_for_root(canonical_root),
        preload_path: preload_path(&store_root),
        graph_dir,
    })
}
