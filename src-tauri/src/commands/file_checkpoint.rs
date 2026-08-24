use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::chat::chat_dir_for;
use super::fs::{canonical_project_root, resolve_workspace_path};

const MAX_BASELINE_BYTES: u64 = 2 * 1024 * 1024;
const ABSENT_MARKER: &str = "__vixl_absent__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpointBaseline {
  pub path: String,
  pub path_hash: String,
  pub existed: bool,
  pub captured_at: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpointRestoreTarget {
  pub path: String,
  pub user_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpointRestoreResult {
  pub restored: Vec<String>,
  pub deleted: Vec<String>,
  pub skipped: Vec<String>,
  pub errors: Vec<FileCheckpointPathError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpointPathError {
  pub path: String,
  pub error: String,
}

fn now_iso() -> String {
  chrono::Utc::now().to_rfc3339()
}

fn path_hash(path: &str) -> String {
  let digest = Sha256::digest(path.as_bytes());
  format!("{digest:x}")
}

fn checkpoints_root(app: &AppHandle, project_slug: &str, chat_id: &str) -> Result<PathBuf, String> {
  Ok(chat_dir_for(app, project_slug, chat_id)?.join("file-checkpoints"))
}

fn message_dir(
  app: &AppHandle,
  project_slug: &str,
  chat_id: &str,
  user_message_id: &str,
) -> Result<PathBuf, String> {
  let dir = checkpoints_root(app, project_slug, chat_id)?.join(user_message_id);
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir)
}

fn manifest_path(dir: &Path) -> PathBuf {
  dir.join("manifest.json")
}

fn content_path(dir: &Path, hash: &str) -> PathBuf {
  dir.join(format!("{hash}.bin"))
}

fn read_manifest(dir: &Path) -> Result<Vec<FileCheckpointBaseline>, String> {
  let path = manifest_path(dir);
  if !path.exists() {
    return Ok(Vec::new());
  }
  let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
  serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_manifest(dir: &Path, entries: &[FileCheckpointBaseline]) -> Result<(), String> {
  let path = manifest_path(dir);
  let raw = serde_json::to_string_pretty(entries).map_err(|error| error.to_string())?;
  fs::write(path, raw).map_err(|error| error.to_string())
}

fn find_entry<'a>(
  entries: &'a [FileCheckpointBaseline],
  path: &str,
) -> Option<&'a FileCheckpointBaseline> {
  entries.iter().find(|entry| entry.path == path)
}

/// Capture a first-touch baseline for `path` under the given user message.
/// Idempotent: if a baseline already exists for this path, returns Ok without changes.
#[tauri::command]
pub fn file_checkpoint_capture(
  app: AppHandle,
  project_slug: String,
  chat_id: String,
  user_message_id: String,
  project_root: String,
  path: String,
  tool_call_id: Option<String>,
) -> Result<FileCheckpointBaseline, String> {
  if project_root.trim().is_empty() {
    return Err("Project root is required to capture file checkpoints".to_string());
  }
  if user_message_id.trim().is_empty() {
    return Err("User message id is required to capture file checkpoints".to_string());
  }

  let _root = canonical_project_root(&project_root)?;
  let absolute = resolve_workspace_path(&project_root, &path)?;
  let dir = message_dir(&app, &project_slug, &chat_id, &user_message_id)?;
  let mut entries = read_manifest(&dir)?;
  if let Some(existing) = find_entry(&entries, &path) {
    return Ok(existing.clone());
  }

  let hash = path_hash(&path);
  let existed = absolute.exists();
  if existed {
    if absolute.is_dir() {
      return Err(format!("Cannot checkpoint directory path: {path}"));
    }
    let meta = fs::metadata(&absolute).map_err(|error| error.to_string())?;
    if meta.len() > MAX_BASELINE_BYTES {
      return Err(format!(
        "File exceeds checkpoint size limit ({MAX_BASELINE_BYTES} bytes): {path}"
      ));
    }
    let bytes = fs::read(&absolute).map_err(|error| error.to_string())?;
    fs::write(content_path(&dir, &hash), bytes).map_err(|error| error.to_string())?;
  } else {
    fs::write(content_path(&dir, &hash), ABSENT_MARKER.as_bytes())
      .map_err(|error| error.to_string())?;
  }

  let entry = FileCheckpointBaseline {
    path: path.clone(),
    path_hash: hash,
    existed,
    captured_at: now_iso(),
    tool_call_id,
  };
  entries.push(entry.clone());
  write_manifest(&dir, &entries)?;
  Ok(entry)
}

/// Restore explicit path baselines. Frontend supplies which (path, userMessageId) to use.
#[tauri::command]
pub fn file_checkpoint_restore(
  app: AppHandle,
  project_slug: String,
  chat_id: String,
  project_root: String,
  targets: Vec<FileCheckpointRestoreTarget>,
) -> Result<FileCheckpointRestoreResult, String> {
  if project_root.trim().is_empty() {
    return Err("Project root is required to restore file checkpoints".to_string());
  }
  let _root = canonical_project_root(&project_root)?;

  let mut restored = Vec::new();
  let mut deleted = Vec::new();
  let mut skipped = Vec::new();
  let mut errors = Vec::new();

  for target in targets {
    match restore_one(
      &app,
      &project_slug,
      &chat_id,
      &project_root,
      &target.path,
      &target.user_message_id,
    ) {
      Ok("restored") => restored.push(target.path),
      Ok("deleted") => deleted.push(target.path),
      Ok("skipped") => skipped.push(target.path),
      Ok(other) => skipped.push(format!("{} ({other})", target.path)),
      Err(error) => errors.push(FileCheckpointPathError {
        path: target.path,
        error,
      }),
    }
  }

  Ok(FileCheckpointRestoreResult {
    restored,
    deleted,
    skipped,
    errors,
  })
}

fn restore_one(
  app: &AppHandle,
  project_slug: &str,
  chat_id: &str,
  project_root: &str,
  path: &str,
  user_message_id: &str,
) -> Result<&'static str, String> {
  let dir = message_dir(app, project_slug, chat_id, user_message_id)?;
  let entries = read_manifest(&dir)?;
  let Some(entry) = find_entry(&entries, path) else {
    return Ok("skipped");
  };

  let absolute = resolve_workspace_path(project_root, path)?;
  let blob = content_path(&dir, &entry.path_hash);

  if !entry.existed {
    if absolute.exists() {
      if absolute.is_dir() {
        return Err(format!("Refusing to delete directory on restore: {path}"));
      }
      fs::remove_file(&absolute).map_err(|error| error.to_string())?;
    }
    return Ok("deleted");
  }

  if !blob.exists() {
    return Err(format!("Missing checkpoint content for {path}"));
  }
  let bytes = fs::read(&blob).map_err(|error| error.to_string())?;
  if bytes == ABSENT_MARKER.as_bytes() {
    return Err(format!("Corrupt checkpoint content for {path}"));
  }
  if let Some(parent) = absolute.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  fs::write(&absolute, bytes).map_err(|error| error.to_string())?;
  Ok("restored")
}

/// Copy `file-checkpoints` from one chat dir to another (used by fork).
pub fn copy_file_checkpoints(
  app: &AppHandle,
  project_slug: &str,
  source_chat_id: &str,
  dest_chat_id: &str,
) -> Result<(), String> {
  let src = checkpoints_root(app, project_slug, source_chat_id)?;
  if !src.is_dir() {
    return Ok(());
  }
  let dst = checkpoints_root(app, project_slug, dest_chat_id)?;
  copy_dir_recursive(&src, &dst)
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
  if from.is_dir() {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
      let entry = entry.map_err(|error| error.to_string())?;
      copy_dir_recursive(&entry.path(), &to.join(entry.file_name()))?;
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
