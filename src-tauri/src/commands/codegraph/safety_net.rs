use std::fs;
use std::path::Path;

use super::meta::upsert_graph_meta;
use super::paths::inplace_codegraph_dir;

/// If CodeGraph still wrote `{project}/.codegraph` after CLI, merge leftovers
/// onto `store_dir` (skip files that already exist) and delete the in-repo dir.
pub fn safety_net_after_cli(project_root: &Path, store_dir: &Path) -> Result<(), String> {
    let inplace = inplace_codegraph_dir(project_root);
    if !inplace.exists() {
        return Ok(());
    }
    fs::create_dir_all(store_dir)
        .map_err(|error| format!("Failed to create graph dir: {error}"))?;
    merge_dir_contents(&inplace, store_dir)?;
    upsert_graph_meta(store_dir, project_root)?;
    fs::remove_dir_all(&inplace)
        .map_err(|error| format!("Failed to remove leftover .codegraph: {error}"))?;
    Ok(())
}

fn merge_dir_contents(src: &Path, dest: &Path) -> Result<(), String> {
    let entries = fs::read_dir(src)
        .map_err(|error| format!("Failed to read leftover .codegraph: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read .codegraph entry: {error}"))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if to.exists() {
            continue;
        }
        relocate(&from, &to)?;
    }
    Ok(())
}

fn relocate(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_recursive(from, to)?;
            if from.is_dir() {
                fs::remove_dir_all(from)
                    .map_err(|e| format!("Failed to remove leftover .codegraph path: {e}"))?;
            } else {
                fs::remove_file(from)
                    .map_err(|e| format!("Failed to remove leftover .codegraph path: {e}"))?;
            }
            Ok(())
        }
    }
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(from)
        .map_err(|error| format!("Failed to stat leftover .codegraph path: {error}"))?;
    if meta.is_dir() {
        fs::create_dir_all(to)
            .map_err(|error| format!("Failed to copy leftover graph dir: {error}"))?;
        for entry in fs::read_dir(from)
            .map_err(|error| format!("Failed to copy leftover graph dir: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Failed to copy leftover graph dir: {error}"))?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to copy leftover graph file: {error}"))?;
    }
    fs::copy(from, to).map_err(|error| format!("Failed to copy leftover graph file: {error}"))?;
    Ok(())
}
