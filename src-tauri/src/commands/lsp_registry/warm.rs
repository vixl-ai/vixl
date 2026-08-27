use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::Path;

use super::builtins::builtin_specs;
use super::helpers::{dedicated_extension_rank, root_marker_score, tier_rank};
use super::types::LspTier;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    "coverage",
    "out",
    ".output",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".vixl",
    ".cache",
    ".turbo",
    ".pnpm-store",
];

const MAX_FILES: usize = 20_000;

pub struct WorkspaceWarmPlan {
    pub server_ids: Vec<String>,
    pub extensions: Vec<String>,
}

fn skip_directory(name: &str) -> bool {
    if SKIP_DIRS.contains(&name) {
        return true;
    }
    name.starts_with('.') && name != ".github"
}

fn extension_for_path(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let lower = name.to_ascii_lowercase();
    if lower == "dockerfile" || lower.starts_with("dockerfile.") {
        return Some("dockerfile".to_string());
    }
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

pub fn collect_workspace_extensions(root: &Path) -> HashSet<String> {
    let mut extensions = HashSet::new();
    let mut files = 0usize;
    let mut stack = VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = stack.pop_front() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if skip_directory(name.as_ref()) {
                    continue;
                }
                stack.push_back(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            files += 1;
            if files > MAX_FILES {
                return extensions;
            }
            if let Some(ext) = extension_for_path(&path) {
                extensions.insert(ext);
            }
        }
    }
    extensions
}

pub fn primary_server_id_for_extension(extension: &str, root: &Path) -> Option<&'static str> {
    let ext = extension.trim_start_matches('.');
    let mut candidates: Vec<_> = builtin_specs()
        .into_iter()
        .filter(|spec| {
            spec.id != "typescript-classic"
                && spec.tier != LspTier::D
                && spec.extensions.iter().any(|configured| {
                    configured
                        .trim_start_matches('.')
                        .eq_ignore_ascii_case(ext)
                })
        })
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|left, right| {
        dedicated_extension_rank(left, ext)
            .cmp(&dedicated_extension_rank(right, ext))
            .then(root_marker_score(Some(root), left).cmp(&root_marker_score(Some(root), right)))
            .then(tier_rank(left.tier).cmp(&tier_rank(right.tier)))
            .then(left.id.cmp(right.id))
    });
    candidates.first().map(|spec| spec.id)
}

/// Servers to start for files actually present in the workspace.
pub fn workspace_warm_plan(root: &Path) -> WorkspaceWarmPlan {
    let mut seen = HashSet::new();
    let mut server_ids = Vec::new();
    let mut extensions = Vec::new();
    let mut found: Vec<String> = collect_workspace_extensions(root).into_iter().collect();
    found.sort();
    for ext in found {
        let Some(id) = primary_server_id_for_extension(&ext, root) else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }
        server_ids.push(id.to_string());
        extensions.push(ext);
    }
    WorkspaceWarmPlan {
        server_ids,
        extensions,
    }
}

pub fn workspace_warm_server_ids(root: &Path) -> Vec<String> {
    workspace_warm_plan(root).server_ids
}
