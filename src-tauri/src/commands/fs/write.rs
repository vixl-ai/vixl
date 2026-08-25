use std::fs;
use std::path::{Path, PathBuf};

use super::diff::build_file_diff;
use super::path::{
    canonical_project_root, reject_sensitive_path, relative_path, resolve_workspace_path,
};
use super::types::{FileDiff, WriteTempHandoffResult};

#[tauri::command]
pub fn fs_write_file(
    project_root: String,
    path: String,
    content: String,
) -> Result<FileDiff, String> {
    reject_sensitive_path(&path)?;
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    let old_content = if absolute.exists() {
        Some(fs::read_to_string(&absolute).map_err(|error| error.to_string())?)
    } else {
        None
    };
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&absolute, &content).map_err(|error| error.to_string())?;
    let operation = if old_content.is_some() {
        "update"
    } else {
        "create"
    };
    Ok(build_file_diff(
        relative_path(&root, &absolute),
        operation,
        old_content,
        Some(content),
    ))
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(from, to).map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn resolve_copy_destination(from: &Path, to: &Path) -> PathBuf {
    if to.exists() && to.is_dir() {
        let file_name = from
            .file_name()
            .map(|value| value.to_owned())
            .unwrap_or_default();
        to.join(file_name)
    } else {
        to.to_path_buf()
    }
}

#[tauri::command]
pub fn fs_rename(project_root: String, from: String, to: String) -> Result<(), String> {
    reject_sensitive_path(&from)?;
    reject_sensitive_path(&to)?;
    let absolute_from = resolve_workspace_path(&project_root, &from)?;
    let absolute_to = resolve_workspace_path(&project_root, &to)?;
    if !absolute_from.exists() {
        return Err("Source path does not exist".to_string());
    }
    if absolute_to.exists() {
        return Err("Destination already exists".to_string());
    }
    if let Some(parent) = absolute_to.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&absolute_from, &absolute_to).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fs_delete(
    project_root: String,
    path: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    reject_sensitive_path(&path)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    if !absolute.exists() {
        return Err("Path does not exist".to_string());
    }

    let meta = fs::symlink_metadata(&absolute).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        if recursive.unwrap_or(false) {
            fs::remove_dir_all(&absolute).map_err(|error| error.to_string())
        } else {
            fs::remove_dir(&absolute).map_err(|error| error.to_string())
        }
    } else {
        fs::remove_file(&absolute).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn fs_copy(project_root: String, from: String, to: String) -> Result<(), String> {
    reject_sensitive_path(&from)?;
    reject_sensitive_path(&to)?;
    let absolute_from = resolve_workspace_path(&project_root, &from)?;
    let absolute_to = resolve_workspace_path(&project_root, &to)?;
    if !absolute_from.exists() {
        return Err("Source path does not exist".to_string());
    }

    let destination = resolve_copy_destination(&absolute_from, &absolute_to);
    if let Some(name) = destination.file_name().and_then(|value| value.to_str()) {
        reject_sensitive_path(name)?;
    }
    if destination.exists() {
        return Err("Destination already exists".to_string());
    }

    copy_recursive(&absolute_from, &destination)
}

#[tauri::command]
pub fn fs_move(project_root: String, from: String, to: String) -> Result<(), String> {
    reject_sensitive_path(&from)?;
    reject_sensitive_path(&to)?;
    let absolute_from = resolve_workspace_path(&project_root, &from)?;
    let absolute_to = resolve_workspace_path(&project_root, &to)?;
    if !absolute_from.exists() {
        return Err("Source path does not exist".to_string());
    }

    let destination = resolve_copy_destination(&absolute_from, &absolute_to);
    if let Some(name) = destination.file_name().and_then(|value| value.to_str()) {
        reject_sensitive_path(name)?;
    }
    if destination.exists() {
        return Err("Destination already exists".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    match fs::rename(&absolute_from, &destination) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_recursive(&absolute_from, &destination)?;
            if absolute_from.is_dir() {
                fs::remove_dir_all(&absolute_from).map_err(|error| error.to_string())?;
            } else {
                fs::remove_file(&absolute_from).map_err(|error| error.to_string())?;
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub fn fs_mkdir(project_root: String, path: String) -> Result<(), String> {
    let absolute = resolve_workspace_path(&project_root, &path)?;
    fs::create_dir_all(&absolute).map_err(|error| error.to_string())
}

fn sanitize_temp_kind(kind: &str) -> Result<String, String> {
    let trimmed = kind.trim();
    if trimmed.is_empty() {
        return Err("Temp kind must not be empty".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid temp kind: {kind}"));
    }
    Ok(trimmed.to_string())
}

fn sanitize_temp_extension(extension: &str) -> Result<String, String> {
    let trimmed = extension.trim().trim_start_matches('.');
    if trimmed.is_empty() {
        return Err("Temp extension must not be empty".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid temp extension: {extension}"));
    }
    Ok(trimmed.to_string())
}

fn decode_base64(content_base64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(content_base64.trim())
        .map_err(|error| format!("Invalid base64 content: {error}"))
}

#[tauri::command]
pub fn write_temp_handoff(content: String) -> Result<WriteTempHandoffResult, String> {
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let filename = format!("handoff-{timestamp}.md");
    let dir = std::env::temp_dir().join("vixl").join("handoffs");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create temp handoffs dir: {error}"))?;
    let absolute = dir.join(&filename);
    fs::write(&absolute, content)
        .map_err(|error| format!("Failed to write temp handoff: {error}"))?;
    Ok(WriteTempHandoffResult {
        path: absolute.to_string_lossy().to_string(),
        filename,
    })
}

/// Writes binary bytes (base64-encoded) under the app temp dir.
#[tauri::command]
pub fn write_temp_bytes(
    content_base64: String,
    kind: String,
    extension: String,
) -> Result<WriteTempHandoffResult, String> {
    let kind = sanitize_temp_kind(&kind)?;
    let extension = sanitize_temp_extension(&extension)?;
    let bytes = decode_base64(&content_base64)?;
    let timestamp = chrono::Utc::now()
        .format("%Y-%m-%dT%H-%M-%S-%3f")
        .to_string();
    let filename = format!("{kind}-{timestamp}.{extension}");
    let dir = std::env::temp_dir().join("vixl").join(&kind);
    fs::create_dir_all(&dir).map_err(|error| format!("Failed to create temp dir: {error}"))?;
    let absolute = dir.join(&filename);
    fs::write(&absolute, bytes).map_err(|error| format!("Failed to write temp bytes: {error}"))?;
    Ok(WriteTempHandoffResult {
        path: absolute.to_string_lossy().to_string(),
        filename,
    })
}

/// Appends a text line to a temp log file. Creates the file when `path` is omitted.
#[tauri::command]
pub fn append_temp_log(
    path: Option<String>,
    kind: String,
    line: String,
) -> Result<WriteTempHandoffResult, String> {
    let kind = sanitize_temp_kind(&kind)?;
    let absolute = if let Some(existing) = path.filter(|value| !value.trim().is_empty()) {
        PathBuf::from(existing)
    } else {
        let timestamp = chrono::Utc::now()
            .format("%Y-%m-%dT%H-%M-%S-%3f")
            .to_string();
        let filename = format!("{kind}-{timestamp}.log");
        let dir = std::env::temp_dir().join("vixl").join(&kind);
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create temp log dir: {error}"))?;
        dir.join(filename)
    };

    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create temp log dir: {error}"))?;
    }

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&absolute)
        .map_err(|error| format!("Failed to open temp log: {error}"))?;
    let mut payload = line;
    if !payload.ends_with('\n') {
        payload.push('\n');
    }
    file.write_all(payload.as_bytes())
        .map_err(|error| format!("Failed to append temp log: {error}"))?;

    let filename = absolute
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{kind}.log"));

    Ok(WriteTempHandoffResult {
        path: absolute.to_string_lossy().to_string(),
        filename,
    })
}

/// Writes plain text to an absolute path chosen by the user (e.g. save dialog).
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let absolute = PathBuf::from(&path);
    if let Some(parent) = absolute.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    fs::write(&absolute, content).map_err(|error| error.to_string())
}
