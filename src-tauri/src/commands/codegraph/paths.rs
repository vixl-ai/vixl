use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::id::graph_id_for_root;
use crate::commands::paths::user_vixl_dir;

pub const PRELOAD_FILE_NAME: &str = "_preload.cjs";
pub const GRAPH_DB_NAME: &str = "codegraph.db";
pub const INPLACE_DIR_NAME: &str = ".codegraph";

pub fn graph_store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = user_vixl_dir(app)?.join("graphs");
    fs::create_dir_all(&dir).map_err(|error| format!("Failed to create graph store: {error}"))?;
    Ok(dir)
}

pub fn graph_dir_for_root(app: &AppHandle, canonical_root: &Path) -> Result<PathBuf, String> {
    Ok(graph_store_dir(app)?.join(graph_id_for_root(canonical_root)))
}

pub fn preload_path(store_root: &Path) -> PathBuf {
    store_root.join(PRELOAD_FILE_NAME)
}

pub fn inplace_codegraph_dir(project_root: &Path) -> PathBuf {
    project_root.join(INPLACE_DIR_NAME)
}

pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0_u64;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let Ok(meta) = fs::symlink_metadata(&child) else {
            continue;
        };
        if meta.is_dir() {
            total += dir_size(&child);
        } else if meta.is_file() {
            total += meta.len();
        }
    }
    total
}
