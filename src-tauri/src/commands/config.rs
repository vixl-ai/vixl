use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::AppHandle;

use super::paths::{resolve_project_vixl_dir, user_vixl_dir};

fn read_json(path: &PathBuf) -> Result<serde_json::Value, String> {
  if !path.exists() {
    return Ok(serde_json::json!({}));
  }
  let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
  if content.trim().is_empty() {
    return Ok(serde_json::json!({}));
  }
  serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_json(path: &PathBuf, value: serde_json::Value) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let content = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
  fs::write(path, content).map_err(|e| e.to_string())
}

fn path_has_vixl_ancestor(path: &Path) -> bool {
  path.ancestors().any(|ancestor| {
    ancestor
      .file_name()
      .and_then(|name| name.to_str())
      .is_some_and(|name| name == ".vixl")
  })
}

/// Resolve `path` for allow-checks: canonicalize when it exists, otherwise
/// canonicalize the nearest existing ancestor and re-join the remaining suffix.
fn resolve_json_path_for_allow_check(path: &Path) -> Result<PathBuf, String> {
  for component in path.components() {
    if matches!(component, Component::ParentDir) {
      return Err("Path traversal is not allowed".to_string());
    }
  }

  if path.exists() {
    return path
      .canonicalize()
      .map_err(|error| format!("Failed to resolve path: {error}"));
  }

  let mut suffix = Vec::new();
  let mut probe = path.to_path_buf();
  loop {
    if probe.exists() {
      let mut resolved = probe
        .canonicalize()
        .map_err(|error| format!("Failed to resolve path: {error}"))?;
      for part in suffix.iter().rev() {
        resolved.push(part);
      }
      return Ok(resolved);
    }
    match probe.file_name() {
      Some(name) => {
        suffix.push(name.to_owned());
        if !probe.pop() {
          break;
        }
      }
      None => break,
    }
  }

  Err("Path cannot be resolved".to_string())
}

fn ensure_json_path_allowed(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
  let user_dir = user_vixl_dir(app)?;
  let user_canon = user_dir
    .canonicalize()
    .unwrap_or_else(|_| user_dir.clone());

  let resolved = resolve_json_path_for_allow_check(path)?;

  if resolved.starts_with(&user_canon) || path_has_vixl_ancestor(&resolved) {
    return Ok(resolved);
  }

  Err("Path is outside allowed .vixl directories".to_string())
}

#[tauri::command]
pub fn read_settings(app: AppHandle, scope: String, root_path: Option<String>) -> Result<serde_json::Value, String> {
  let path = settings_path(&app, &scope, root_path)?;
  read_json(&path)
}

#[tauri::command]
pub fn write_settings(
  app: AppHandle,
  scope: String,
  root_path: Option<String>,
  settings: serde_json::Value,
) -> Result<(), String> {
  let path = settings_path(&app, &scope, root_path)?;
  write_json(&path, settings)
}

#[tauri::command]
pub fn read_mcp_config(app: AppHandle, scope: String, root_path: Option<String>) -> Result<serde_json::Value, String> {
  let path = mcp_path(&app, &scope, root_path)?;
  read_json(&path)
}

#[tauri::command]
pub fn write_mcp_config(
  app: AppHandle,
  scope: String,
  root_path: Option<String>,
  config: serde_json::Value,
) -> Result<(), String> {
  let path = mcp_path(&app, &scope, root_path)?;
  write_json(&path, config)
}

#[tauri::command]
pub fn read_json_file(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
  let allowed = ensure_json_path_allowed(&app, Path::new(&path))?;
  read_json(&allowed)
}

#[tauri::command]
pub fn write_json_file(
  app: AppHandle,
  path: String,
  value: serde_json::Value,
) -> Result<(), String> {
  let allowed = ensure_json_path_allowed(&app, Path::new(&path))?;
  write_json(&allowed, value)
}

#[tauri::command]
pub fn config_exists(app: AppHandle, scope: String, root_path: Option<String>) -> Result<bool, String> {
  let path = settings_path(&app, &scope, root_path)?;
  Ok(path.exists())
}

fn settings_path(app: &AppHandle, scope: &str, root_path: Option<String>) -> Result<PathBuf, String> {
  base_path(app, scope, root_path).map(|p| p.join("settings.json"))
}

pub(crate) fn tray_background_enabled(_app: &AppHandle) -> bool {
  true
}

fn mcp_path(app: &AppHandle, scope: &str, root_path: Option<String>) -> Result<PathBuf, String> {
  base_path(app, scope, root_path).map(|p| p.join("mcp.json"))
}

fn lsp_path(app: &AppHandle) -> Result<PathBuf, String> {
  user_vixl_dir(app).map(|p| p.join("lsp.json"))
}

pub(crate) fn load_lsp_config(app: &AppHandle) -> Result<serde_json::Value, String> {
  let path = lsp_path(app)?;
  read_json(&path)
}

pub(crate) fn write_lsp_config_internal(
  app: &AppHandle,
  config: serde_json::Value,
) -> Result<(), String> {
  let path = lsp_path(app)?;
  write_json(&path, config)
}

#[tauri::command]
pub fn read_lsp_config(app: AppHandle) -> Result<serde_json::Value, String> {
  load_lsp_config(&app)
}

#[tauri::command]
pub fn write_lsp_config(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
  write_lsp_config_internal(&app, config)
}

pub(crate) fn read_settings_for_lsp(app: &AppHandle) -> Result<serde_json::Value, String> {
  read_settings_internal(app, "personal", None)
}

/// Returns true when the workspace root is trusted for project-local LSP execution.
pub(crate) fn workspace_is_trusted(app: &AppHandle, project_root: Option<&str>) -> bool {
  let Some(root) = project_root else {
    return false;
  };
  let Ok(canonical) = std::fs::canonicalize(root) else {
    return false;
  };
  let canonical_str = canonical.to_string_lossy().to_string();

  let Ok(personal) = read_settings_internal(app, "personal", None) else {
    return false;
  };

  if let Some(records) = personal.get("workspace.trust").and_then(|v| v.as_array()) {
    for record in records {
      let path = record
        .get("rootPath")
        .or_else(|| record.get("root_path"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
      let trusted = record
        .get("trusted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      if !trusted || path.is_empty() {
        continue;
      }
      if let Ok(record_canon) = std::fs::canonicalize(path) {
        if record_canon == canonical {
          return true;
        }
      } else if path == root || path == canonical_str {
        return true;
      }
    }
  }

  false
}

fn read_settings_internal(
  app: &AppHandle,
  scope: &str,
  root_path: Option<String>,
) -> Result<serde_json::Value, String> {
  let path = settings_path(app, scope, root_path)?;
  read_json(&path)
}

fn base_path(app: &AppHandle, scope: &str, root_path: Option<String>) -> Result<PathBuf, String> {
  match scope {
    "personal" => user_vixl_dir(app),
    "project" => {
      let root = root_path.ok_or_else(|| "root_path required for project scope".to_string())?;
      let dir = resolve_project_vixl_dir(&root);
      fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
      Ok(dir)
    }
    other => Err(format!("unknown scope: {other}")),
  }
}
