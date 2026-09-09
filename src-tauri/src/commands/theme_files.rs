use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::config::write_atomic;

/// Upper bound for shareable theme files. Enforced in Rust *before* the
/// content is read or parsed so oversized payloads never reach the webview.
pub const MAX_THEME_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Debug)]
pub struct ThemeFileContent {
    pub content: String,
    pub size_bytes: usize,
}

fn resolve_theme_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty() {
        return Err("Theme file path is empty".to_string());
    }
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("Path traversal is not allowed".to_string());
        }
    }
    Ok(path.to_path_buf())
}

/// Read a user-selected `.vixl-theme.json` file as raw text.
///
/// Unlike `read_json_file` (which is restricted to `.vixl` directories and
/// parses eagerly), this command is meant for files picked through the native
/// open dialog and returns unparsed text so the frontend can enforce the
/// strict shareable-theme schema itself.
#[tauri::command]
pub fn read_theme_file(path: String) -> Result<ThemeFileContent, String> {
    let path = resolve_theme_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read theme file: {e}"))?;
    if !metadata.is_file() {
        return Err("Theme path is not a file".to_string());
    }
    if metadata.len() > MAX_THEME_FILE_BYTES {
        return Err(format!(
            "Theme file is too large ({} bytes, limit is {} bytes)",
            metadata.len(),
            MAX_THEME_FILE_BYTES
        ));
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read theme file: {e}"))?;
    Ok(ThemeFileContent {
        size_bytes: content.len(),
        content,
    })
}

/// Write a canonical theme JSON payload to a user-selected path.
///
/// The payload is validated as JSON and size-capped, then written atomically
/// (temp file + rename) so an interrupted save never leaves a truncated file.
#[tauri::command]
pub fn write_theme_file(path: String, content: String) -> Result<(), String> {
    let path = resolve_theme_path(&path)?;
    if content.len() as u64 > MAX_THEME_FILE_BYTES {
        return Err(format!(
            "Theme file is too large ({} bytes, limit is {} bytes)",
            content.len(),
            MAX_THEME_FILE_BYTES
        ));
    }
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|_| "Theme file content is not valid JSON".to_string())?;
    write_atomic(&path, &content)
}
