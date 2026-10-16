use std::fs;
use std::path::{Component, Path, PathBuf};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpointCaptureResult {
    pub captured: Vec<FileCheckpointBaseline>,
    pub skipped_oversize: Vec<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn path_hash(path: &str) -> String {
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

pub(crate) fn content_path(dir: &Path, hash: &str) -> PathBuf {
    dir.join(format!("{hash}.bin"))
}

pub(crate) fn read_manifest(dir: &Path) -> Result<Vec<FileCheckpointBaseline>, String> {
    let path = manifest_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

pub(crate) fn write_manifest(dir: &Path, entries: &[FileCheckpointBaseline]) -> Result<(), String> {
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

fn manifest_key(path: &str, key: Option<&str>) -> String {
    match key {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        _ => path.to_string(),
    }
}

fn join_posix(base: &str, relative: &str) -> String {
    if relative.is_empty() {
        return base.to_string();
    }
    if base.is_empty() {
        return relative.to_string();
    }
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        relative.trim_start_matches('/')
    )
}

fn posix_relative(from: &Path, to: &Path) -> Result<String, String> {
    let rel = to
        .strip_prefix(from)
        .map_err(|_| format!("File is not under directory: {}", to.to_string_lossy()))?;
    let mut parts = Vec::new();
    for component in rel.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return Err("Invalid relative path component".to_string()),
        }
    }
    Ok(parts.join("/"))
}

fn collect_dir_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let reader = fs::read_dir(&current).map_err(|error| error.to_string())?;
        for entry in reader {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            if meta.is_file() {
                files.push(path);
                continue;
            }
            if meta.file_type().is_symlink() && path.is_file() {
                files.push(path);
            }
        }
    }
    Ok(())
}

enum CaptureOne {
    Captured(FileCheckpointBaseline),
    Existing(FileCheckpointBaseline),
    SkippedOversize(String),
}

fn capture_one_file(
    dir: &Path,
    entries: &mut Vec<FileCheckpointBaseline>,
    project_root: &str,
    path: &str,
    key: Option<&str>,
    tool_call_id: Option<String>,
    skip_oversize: bool,
) -> Result<CaptureOne, String> {
    let stored_path = manifest_key(path, key);
    if let Some(existing) = find_entry(entries, &stored_path) {
        return Ok(CaptureOne::Existing(existing.clone()));
    }

    let absolute = resolve_workspace_path(project_root, path)?;
    let hash = path_hash(&stored_path);
    let existed = absolute.exists();
    if existed {
        let meta = fs::symlink_metadata(&absolute).map_err(|error| error.to_string())?;
        if meta.is_dir() {
            return Err(format!("Cannot checkpoint directory path: {path}"));
        }
        let file_meta = fs::metadata(&absolute).map_err(|error| error.to_string())?;
        if file_meta.len() > MAX_BASELINE_BYTES {
            if skip_oversize {
                return Ok(CaptureOne::SkippedOversize(stored_path));
            }
            return Err(format!(
                "File exceeds checkpoint size limit ({MAX_BASELINE_BYTES} bytes): {path}"
            ));
        }
        let bytes = fs::read(&absolute).map_err(|error| error.to_string())?;
        fs::write(content_path(dir, &hash), bytes).map_err(|error| error.to_string())?;
    } else {
        fs::write(content_path(dir, &hash), ABSENT_MARKER.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let entry = FileCheckpointBaseline {
        path: stored_path,
        path_hash: hash,
        existed,
        captured_at: now_iso(),
        tool_call_id,
    };
    entries.push(entry.clone());
    write_manifest(dir, entries)?;
    Ok(CaptureOne::Captured(entry))
}

fn capture_directory(
    dir: &Path,
    project_root: &str,
    path: &str,
    key: Option<&str>,
    tool_call_id: Option<String>,
    absolute: &Path,
) -> Result<FileCheckpointCaptureResult, String> {
    let stored_prefix = manifest_key(path, key);
    let mut files = Vec::new();
    collect_dir_files(absolute, &mut files)?;
    files.sort_by(|left, right| left.as_os_str().cmp(right.as_os_str()));

    let mut entries = read_manifest(dir)?;
    let mut captured = Vec::new();
    let mut skipped_oversize = Vec::new();

    for file in files {
        let relative = posix_relative(absolute, &file)?;
        let file_path = join_posix(path, &relative);
        let file_key = join_posix(&stored_prefix, &relative);
        let key_arg = if file_key == file_path {
            None
        } else {
            Some(file_key.as_str())
        };
        match capture_one_file(
            dir,
            &mut entries,
            project_root,
            &file_path,
            key_arg,
            tool_call_id.clone(),
            true,
        )? {
            CaptureOne::Captured(entry) | CaptureOne::Existing(entry) => captured.push(entry),
            CaptureOne::SkippedOversize(skipped) => skipped_oversize.push(skipped),
        }
    }

    Ok(FileCheckpointCaptureResult {
        captured,
        skipped_oversize,
    })
}

pub(crate) fn capture_into(
    dir: &Path,
    project_root: &str,
    path: &str,
    key: Option<&str>,
    tool_call_id: Option<String>,
) -> Result<FileCheckpointCaptureResult, String> {
    if project_root.trim().is_empty() {
        return Err("Project root is required to capture file checkpoints".to_string());
    }

    let _root = canonical_project_root(project_root)?;
    let absolute = resolve_workspace_path(project_root, path)?;
    let existed = absolute.exists();
    if existed {
        let meta = fs::symlink_metadata(&absolute).map_err(|error| error.to_string())?;
        if meta.is_dir() {
            return capture_directory(dir, project_root, path, key, tool_call_id, &absolute);
        }
    }

    let mut entries = read_manifest(dir)?;
    match capture_one_file(
        dir,
        &mut entries,
        project_root,
        path,
        key,
        tool_call_id,
        false,
    )? {
        CaptureOne::Captured(entry) | CaptureOne::Existing(entry) => {
            Ok(FileCheckpointCaptureResult {
                captured: vec![entry],
                skipped_oversize: Vec::new(),
            })
        }
        CaptureOne::SkippedOversize(_) => Err(format!(
            "File exceeds checkpoint size limit ({MAX_BASELINE_BYTES} bytes): {path}"
        )),
    }
}

/// Capture a first-touch baseline for `path` under the given user message.
/// Directories are expanded into one baseline per contained file (no gitignore).
/// Idempotent: if a baseline already exists for a path, it is reused.
#[tauri::command]
pub fn file_checkpoint_capture(
    app: AppHandle,
    project_slug: String,
    chat_id: String,
    user_message_id: String,
    project_root: String,
    path: String,
    key: Option<String>,
    tool_call_id: Option<String>,
) -> Result<FileCheckpointCaptureResult, String> {
    if user_message_id.trim().is_empty() {
        return Err("User message id is required to capture file checkpoints".to_string());
    }
    let dir = message_dir(&app, &project_slug, &chat_id, &user_message_id)?;
    capture_into(&dir, &project_root, &path, key.as_deref(), tool_call_id)
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
            target.key.as_deref(),
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
    key: Option<&str>,
    user_message_id: &str,
) -> Result<&'static str, String> {
    let dir = message_dir(app, project_slug, chat_id, user_message_id)?;
    restore_from_dir(&dir, project_root, path, key)
}

pub(crate) fn restore_from_dir(
    dir: &Path,
    project_root: &str,
    path: &str,
    key: Option<&str>,
) -> Result<&'static str, String> {
    let entries = read_manifest(dir)?;
    let lookup = manifest_key(path, key);
    let Some(entry) = find_entry(&entries, &lookup) else {
        return Ok("skipped");
    };

    let absolute = resolve_workspace_path(project_root, path)?;
    let blob = content_path(dir, &entry.path_hash);

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

#[cfg(test)]
mod tests {
    use super::{
        capture_into, content_path, manifest_key, path_hash, read_manifest, restore_from_dir,
        FileCheckpointBaseline, MAX_BASELINE_BYTES,
    };
    use std::fs;
    use std::path::Path;

    fn write_file(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent dir");
        }
        fs::write(path, bytes).expect("write file");
    }

    fn baseline_for<'a>(
        entries: &'a [FileCheckpointBaseline],
        path: &str,
    ) -> &'a FileCheckpointBaseline {
        entries
            .iter()
            .find(|entry| entry.path == path)
            .unwrap_or_else(|| panic!("missing baseline {path}"))
    }

    #[test]
    fn manifest_key_defaults_to_path() {
        assert_eq!(manifest_key("src/a.ts", None), "src/a.ts");
        assert_eq!(manifest_key("src/a.ts", Some("")), "src/a.ts");
        assert_eq!(manifest_key("src/a.ts", Some("   ")), "src/a.ts");
    }

    #[test]
    fn manifest_key_uses_explicit_key() {
        assert_eq!(manifest_key("src/a.ts", Some("web/src/a.ts")), "web/src/a.ts");
    }

    #[test]
    fn path_hash_differs_for_member_prefixed_keys() {
        assert_ne!(path_hash("api/src/a.ts"), path_hash("web/src/a.ts"));
        assert_eq!(path_hash("src/a.ts"), path_hash("src/a.ts"));
    }

    #[test]
    fn single_file_capture_writes_same_manifest_entry() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        write_file(project.path(), "src/a.ts", b"hello");

        let result = capture_into(
            checkpoints.path(),
            project.path().to_str().expect("utf8"),
            "src/a.ts",
            None,
            Some("tc-1".to_string()),
        )
        .expect("capture");

        assert!(result.skipped_oversize.is_empty());
        assert_eq!(result.captured.len(), 1);
        let entry = &result.captured[0];
        assert_eq!(entry.path, "src/a.ts");
        assert_eq!(entry.path_hash, path_hash("src/a.ts"));
        assert!(entry.existed);
        assert_eq!(entry.tool_call_id.as_deref(), Some("tc-1"));
        assert!(!entry.captured_at.is_empty());

        let manifest = read_manifest(checkpoints.path()).expect("manifest");
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].path, "src/a.ts");
        assert_eq!(manifest[0].path_hash, path_hash("src/a.ts"));
        assert!(manifest[0].existed);
        let blob =
            fs::read(content_path(checkpoints.path(), &manifest[0].path_hash)).expect("blob");
        assert_eq!(blob, b"hello");
    }

    #[test]
    fn single_file_oversize_still_errors() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        let oversized = vec![0u8; (MAX_BASELINE_BYTES as usize) + 1];
        write_file(project.path(), "src/big.bin", &oversized);

        let error = capture_into(
            checkpoints.path(),
            project.path().to_str().expect("utf8"),
            "src/big.bin",
            None,
            None,
        )
        .expect_err("oversize file");
        assert!(error.contains("File exceeds checkpoint size limit"));
        assert!(read_manifest(checkpoints.path())
            .expect("manifest")
            .is_empty());
    }

    #[test]
    fn directory_capture_writes_per_file_keys() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        write_file(project.path(), "eval-dir/a.md", b"alpha");
        write_file(project.path(), "eval-dir/nested/b.md", b"beta");

        let result = capture_into(
            checkpoints.path(),
            project.path().to_str().expect("utf8"),
            "eval-dir",
            Some("rpg-test/eval-dir"),
            Some("tc-dir".to_string()),
        )
        .expect("capture dir");

        assert!(result.skipped_oversize.is_empty());
        let mut paths: Vec<_> = result
            .captured
            .iter()
            .map(|entry| entry.path.clone())
            .collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "rpg-test/eval-dir/a.md".to_string(),
                "rpg-test/eval-dir/nested/b.md".to_string()
            ]
        );

        let manifest = read_manifest(checkpoints.path()).expect("manifest");
        assert!(find_dir_entry(&manifest, "rpg-test/eval-dir").is_none());
        let a = baseline_for(&manifest, "rpg-test/eval-dir/a.md");
        assert_eq!(a.path_hash, path_hash("rpg-test/eval-dir/a.md"));
        assert!(a.existed);
        assert_eq!(a.tool_call_id.as_deref(), Some("tc-dir"));
        let nested = baseline_for(&manifest, "rpg-test/eval-dir/nested/b.md");
        assert_eq!(nested.path_hash, path_hash("rpg-test/eval-dir/nested/b.md"));
        assert_eq!(
            fs::read(content_path(checkpoints.path(), &a.path_hash)).expect("a blob"),
            b"alpha"
        );
        assert_eq!(
            fs::read(content_path(checkpoints.path(), &nested.path_hash)).expect("b blob"),
            b"beta"
        );
    }

    fn find_dir_entry<'a>(
        entries: &'a [FileCheckpointBaseline],
        path: &str,
    ) -> Option<&'a FileCheckpointBaseline> {
        entries.iter().find(|entry| entry.path == path)
    }

    #[test]
    fn directory_capture_skips_oversize_and_reports_key() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        write_file(project.path(), "eval-dir/ok.md", b"ok");
        let oversized = vec![0u8; (MAX_BASELINE_BYTES as usize) + 1];
        write_file(project.path(), "eval-dir/huge.bin", &oversized);

        let result = capture_into(
            checkpoints.path(),
            project.path().to_str().expect("utf8"),
            "eval-dir",
            Some("rpg-test/eval-dir"),
            None,
        )
        .expect("capture dir");

        assert_eq!(result.captured.len(), 1);
        assert_eq!(result.captured[0].path, "rpg-test/eval-dir/ok.md");
        assert_eq!(result.skipped_oversize, vec!["rpg-test/eval-dir/huge.bin"]);
        let manifest = read_manifest(checkpoints.path()).expect("manifest");
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].path, "rpg-test/eval-dir/ok.md");
    }

    #[test]
    fn directory_capture_round_trips_restore_without_dir_path() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        let root = project.path().to_str().expect("utf8");
        write_file(project.path(), "eval-dir/a.md", b"alpha");
        write_file(project.path(), "eval-dir/nested/b.md", b"beta");

        let result = capture_into(
            checkpoints.path(),
            root,
            "eval-dir",
            Some("rpg-test/eval-dir"),
            None,
        )
        .expect("capture dir");

        fs::remove_dir_all(project.path().join("eval-dir")).expect("delete dir");
        assert!(!project.path().join("eval-dir").exists());

        assert_eq!(
            restore_from_dir(
                checkpoints.path(),
                root,
                "eval-dir",
                Some("rpg-test/eval-dir")
            )
            .expect("restore dir path"),
            "skipped"
        );

        for entry in &result.captured {
            let relative = entry.path.strip_prefix("rpg-test/").expect("member prefix");
            let status = restore_from_dir(
                checkpoints.path(),
                root,
                relative,
                Some(entry.path.as_str()),
            )
            .expect("restore file");
            assert_eq!(status, "restored");
        }

        assert_eq!(
            fs::read(project.path().join("eval-dir/a.md")).expect("restored a"),
            b"alpha"
        );
        assert_eq!(
            fs::read(project.path().join("eval-dir/nested/b.md")).expect("restored b"),
            b"beta"
        );
    }

    #[test]
    fn missing_file_capture_writes_absent_marker() {
        let project = tempfile::TempDir::new().expect("project");
        let checkpoints = tempfile::TempDir::new().expect("checkpoints");
        fs::create_dir_all(project.path().join("src")).expect("src");

        let result = capture_into(
            checkpoints.path(),
            project.path().to_str().expect("utf8"),
            "src/missing.ts",
            None,
            None,
        )
        .expect("capture missing");

        assert_eq!(result.captured.len(), 1);
        assert!(!result.captured[0].existed);
        assert_eq!(result.captured[0].path, "src/missing.ts");
        let blob = fs::read(content_path(
            checkpoints.path(),
            &result.captured[0].path_hash,
        ))
        .expect("blob");
        assert_eq!(blob, super::ABSENT_MARKER.as_bytes());
    }
}
