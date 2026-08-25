use std::fs;
use std::path::Path;

use super::path::{
    canonical_project_root, entry_kind, modified_ms, relative_path, resolve_workspace_path,
};
use super::types::{FsDirEntry, FsReadFileResult, FsStatResult, FsTreeNode};

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn is_image_path(path: &Path) -> bool {
    image_mime_type(path).is_some()
}

#[tauri::command]
pub fn fs_read_file(
    project_root: String,
    path: String,
    offset: Option<u32>,
    limit: Option<u32>,
    include_base64: Option<bool>,
) -> Result<FsReadFileResult, String> {
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    let rel = relative_path(&root, &absolute);

    if is_image_path(&absolute) {
        let metadata = fs::metadata(&absolute).map_err(|error| error.to_string())?;
        let mime_type = image_mime_type(&absolute).map(str::to_string);
        let is_svg = mime_type.as_deref() == Some("image/svg+xml");

        if is_svg {
            let content = fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
            let lines: Vec<&str> = content.lines().collect();
            let total_lines = lines.len() as u32;
            let start = (offset.unwrap_or(1).saturating_sub(1) as usize).min(lines.len());
            let max = limit.unwrap_or(total_lines.max(1)) as usize;
            let end = start.saturating_add(max).min(lines.len());
            let slice = lines[start..end].join("\n");

            return Ok(FsReadFileResult {
                path: rel,
                content: slice,
                total_lines,
                offset: (start as u32) + 1,
                limit: (end - start) as u32,
                is_image: Some(true),
                mime_type,
                size_bytes: Some(metadata.len()),
                base64: None,
            });
        }

        let encoded = if include_base64.unwrap_or(true) {
            let bytes = fs::read(&absolute).map_err(|error| error.to_string())?;
            Some(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                bytes,
            ))
        } else {
            None
        };

        return Ok(FsReadFileResult {
            path: rel,
            content: String::new(),
            total_lines: 0,
            offset: 0,
            limit: 0,
            is_image: Some(true),
            mime_type,
            size_bytes: Some(metadata.len()),
            base64: encoded,
        });
    }

    let content = fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len() as u32;
    let start = (offset.unwrap_or(1).saturating_sub(1) as usize).min(lines.len());
    let max = limit.unwrap_or(total_lines.max(1)) as usize;
    let end = start.saturating_add(max).min(lines.len());
    let slice = lines[start..end].join("\n");

    Ok(FsReadFileResult {
        path: rel,
        content: slice,
        total_lines,
        offset: (start as u32) + 1,
        limit: (end - start) as u32,
        is_image: None,
        mime_type: None,
        size_bytes: None,
        base64: None,
    })
}

#[tauri::command]
pub fn fs_list_dir(project_root: String, path: String) -> Result<Vec<FsDirEntry>, String> {
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    if !absolute.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries = Vec::new();
    // Skip unreadable entries instead of failing the whole listing.
    if let Ok(read_dir) = fs::read_dir(&absolute) {
        for entry in read_dir.flatten() {
            let entry_path = entry.path();
            let Ok(kind) = entry_kind(&entry_path) else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = relative_path(&root, &entry_path);
            entries.push(FsDirEntry {
                name,
                path: rel,
                kind,
            });
        }
    }

    entries.sort_by_key(|left| left.name.to_lowercase());
    Ok(entries)
}

fn build_tree(root: &Path, dir: &Path, depth: u32, max_depth: u32) -> Result<FsTreeNode, String> {
    let name = dir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    let rel = relative_path(root, dir);
    let kind = entry_kind(dir)?;

    let children = if kind == "directory" && depth < max_depth {
        let mut nodes = Vec::new();
        // Skip unreadable entries (common in home dirs: Library, .Trash, etc.)
        // instead of failing the entire tree.
        if let Ok(read_dir) = fs::read_dir(dir) {
            for entry in read_dir.flatten() {
                if let Ok(node) = build_tree(root, &entry.path(), depth + 1, max_depth) {
                    nodes.push(node);
                }
            }
        }
        nodes.sort_by_key(|left| left.name.to_lowercase());
        Some(nodes)
    } else {
        None
    };

    Ok(FsTreeNode {
        name,
        path: rel,
        kind,
        children,
    })
}

#[tauri::command]
pub fn fs_list_dir_tree(
    project_root: String,
    path: String,
    max_depth: Option<u32>,
) -> Result<FsTreeNode, String> {
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    if !absolute.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    let depth = max_depth.unwrap_or(4);
    build_tree(&root, &absolute, 0, depth)
}

#[tauri::command]
pub fn fs_stat(project_root: String, path: String) -> Result<FsStatResult, String> {
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    if !absolute.exists() {
        return Ok(FsStatResult {
            path: relative_path(&root, &absolute),
            exists: false,
            kind: "missing".to_string(),
            size: 0,
            modified_ms: None,
        });
    }

    let meta = fs::metadata(&absolute).map_err(|error| error.to_string())?;
    Ok(FsStatResult {
        path: relative_path(&root, &absolute),
        exists: true,
        kind: entry_kind(&absolute)?,
        size: meta.len(),
        modified_ms: modified_ms(&absolute),
    })
}
