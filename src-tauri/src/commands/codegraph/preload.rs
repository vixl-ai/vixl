use std::fs;
use std::path::Path;

use super::paths::preload_path;

const PRELOAD_SOURCE: &str = include_str!("../../../resources/codegraph-store-preload.cjs");

pub fn ensure_preload_file(store_root: &Path) -> Result<(), String> {
    fs::create_dir_all(store_root)
        .map_err(|error| format!("Failed to create graph store: {error}"))?;
    let path = preload_path(store_root);
    if path.is_file() {
        if let Ok(existing) = fs::read_to_string(&path) {
            if existing == PRELOAD_SOURCE {
                return Ok(());
            }
        }
    }
    fs::write(&path, PRELOAD_SOURCE)
        .map_err(|error| format!("Failed to write CodeGraph store preload: {error}"))?;
    Ok(())
}

/// Rewrite `{project}/.codegraph` (and children) onto `store`. Mirrors the CJS preload.
pub fn rewrite_codegraph_path(computed: &str, project: &str, store: &str) -> String {
    let normalized = normalize_separators(computed);
    let prefix = format!("{}/.codegraph", trim_trailing_separators(project));
    if normalized == prefix || normalized.starts_with(&format!("{prefix}/")) {
        let next = format!(
            "{}{}",
            trim_trailing_separators(store),
            &normalized[prefix.len()..]
        );
        if computed.contains('\\') && !computed.contains('/') {
            return next.replace('/', "\\");
        }
        return next;
    }
    computed.to_string()
}

fn normalize_separators(value: &str) -> String {
    value.replace('\\', "/")
}

fn trim_trailing_separators(value: &str) -> String {
    normalize_separators(value)
        .trim_end_matches('/')
        .to_string()
}
