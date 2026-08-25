use super::diff::build_file_diff;
use super::path::{
    canonical_project_root, reject_sensitive_path, relative_path, resolve_workspace_path,
};
use super::types::{FileDiff, FsEditReplacement, FsStagePreviewRequest};
use std::fs;

pub(crate) fn apply_replacements(
    content: &str,
    replacements: &[FsEditReplacement],
) -> Result<String, String> {
    let mut updated = content.to_string();
    for replacement in replacements {
        if replacement.old_string.is_empty() {
            return Err("Replacement old_string cannot be empty".to_string());
        }
        if replacement.replace_all {
            if !updated.contains(&replacement.old_string) {
                return Err("old_string was not found in file".to_string());
            }
            updated = updated.replace(&replacement.old_string, &replacement.new_string);
            continue;
        }
        let count = updated.matches(&replacement.old_string).count();
        if count == 0 {
            return Err("old_string was not found in file".to_string());
        }
        if count > 1 {
            return Err(
                "old_string is not unique; enable replace_all or provide more context".to_string(),
            );
        }
        updated = updated.replacen(&replacement.old_string, &replacement.new_string, 1);
    }
    Ok(updated)
}

#[derive(Debug)]
enum PatchOperation {
    Add { path: String, content: String },
    Update { path: String, content: String },
    Delete { path: String },
}

fn parse_patch(patch: &str) -> Result<Vec<PatchOperation>, String> {
    let trimmed = patch.trim();
    if trimmed.is_empty() {
        return Err("Patch is empty".to_string());
    }

    let lines: Vec<&str> = trimmed.lines().collect();
    let mut index = 0usize;
    if lines
        .first()
        .is_some_and(|line| line.trim() == "*** Begin Patch")
    {
        index = 1;
    }

    let mut operations = Vec::new();
    while index < lines.len() {
        let line = lines[index].trim();
        if line == "*** End Patch" {
            break;
        }
        if line.is_empty() {
            index += 1;
            continue;
        }

        if let Some(path) = line.strip_prefix("*** Add File:") {
            let path = path.trim().to_string();
            index += 1;
            let mut content = String::new();
            while index < lines.len() {
                let next = lines[index];
                if next.trim().starts_with("*** ") {
                    break;
                }
                if let Some(rest) = next.strip_prefix('+') {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(rest);
                } else if next.trim().is_empty() {
                    content.push('\n');
                } else {
                    return Err(format!("Invalid add file line in patch: {next}"));
                }
                index += 1;
            }
            operations.push(PatchOperation::Add { path, content });
            continue;
        }

        if let Some(path) = line.strip_prefix("*** Update File:") {
            let path = path.trim().to_string();
            index += 1;
            let mut content = String::new();
            while index < lines.len() {
                let next = lines[index];
                if next.trim().starts_with("*** ") {
                    break;
                }
                if !content.is_empty() {
                    content.push('\n');
                }
                content.push_str(next);
                index += 1;
            }
            operations.push(PatchOperation::Update { path, content });
            continue;
        }

        if let Some(path) = line.strip_prefix("*** Delete File:") {
            operations.push(PatchOperation::Delete {
                path: path.trim().to_string(),
            });
            index += 1;
            continue;
        }

        return Err(format!("Unrecognized patch header: {line}"));
    }

    if operations.is_empty() {
        return Err("Patch contains no file operations".to_string());
    }

    Ok(operations)
}

fn apply_update_patch(existing: &str, patched: &str) -> Result<String, String> {
    let mut result = String::new();
    let mut old_index = 0usize;
    let old_lines: Vec<&str> = existing.lines().collect();
    let patch_lines: Vec<&str> = patched.lines().collect();
    let mut patch_index = 0usize;

    while patch_index < patch_lines.len() {
        let line = patch_lines[patch_index];
        if line.starts_with("@@") {
            patch_index += 1;
            continue;
        }
        if let Some(removed) = line.strip_prefix('-') {
            if old_index >= old_lines.len() || old_lines[old_index] != removed {
                return Err("Patch context does not match file contents".to_string());
            }
            old_index += 1;
            patch_index += 1;
            continue;
        }
        if let Some(added) = line.strip_prefix('+') {
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(added);
            patch_index += 1;
            continue;
        }
        if old_index < old_lines.len() && old_lines[old_index] == line {
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(line);
            old_index += 1;
            patch_index += 1;
            continue;
        }
        return Err("Patch context does not match file contents".to_string());
    }

    while old_index < old_lines.len() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(old_lines[old_index]);
        old_index += 1;
    }

    Ok(result)
}

pub(crate) fn preview_patch(project_root: &str, patch: &str) -> Result<Vec<FileDiff>, String> {
    let root = canonical_project_root(project_root)?;
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();

    for operation in operations {
        match operation {
            PatchOperation::Add { path, content } => {
                reject_sensitive_path(&path)?;
                let _ = resolve_workspace_path(project_root, &path)?;
                diffs.push(build_file_diff(path, "create", None, Some(content)));
            }
            PatchOperation::Update { path, content } => {
                reject_sensitive_path(&path)?;
                let absolute = resolve_workspace_path(project_root, &path)?;
                let old_content =
                    fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
                let new_content = apply_update_patch(&old_content, &content)?;
                diffs.push(build_file_diff(
                    relative_path(&root, &absolute),
                    "update",
                    Some(old_content),
                    Some(new_content),
                ));
            }
            PatchOperation::Delete { path } => {
                reject_sensitive_path(&path)?;
                let absolute = resolve_workspace_path(project_root, &path)?;
                let old_content =
                    fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    relative_path(&root, &absolute),
                    "delete",
                    Some(old_content),
                    None,
                ));
            }
        }
    }

    Ok(diffs)
}

pub(crate) fn apply_patch_operations(
    project_root: &str,
    patch: &str,
) -> Result<Vec<FileDiff>, String> {
    let root = canonical_project_root(project_root)?;
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();

    for operation in operations {
        match operation {
            PatchOperation::Add { path, content } => {
                reject_sensitive_path(&path)?;
                let absolute = resolve_workspace_path(project_root, &path)?;
                if let Some(parent) = absolute.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(&absolute, &content).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    relative_path(&root, &absolute),
                    "create",
                    None,
                    Some(content),
                ));
            }
            PatchOperation::Update { path, content } => {
                reject_sensitive_path(&path)?;
                let absolute = resolve_workspace_path(project_root, &path)?;
                let old_content =
                    fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
                let new_content = apply_update_patch(&old_content, &content)?;
                fs::write(&absolute, &new_content).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    relative_path(&root, &absolute),
                    "update",
                    Some(old_content),
                    Some(new_content),
                ));
            }
            PatchOperation::Delete { path } => {
                reject_sensitive_path(&path)?;
                let absolute = resolve_workspace_path(project_root, &path)?;
                let old_content =
                    fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
                fs::remove_file(&absolute).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    relative_path(&root, &absolute),
                    "delete",
                    Some(old_content),
                    None,
                ));
            }
        }
    }

    Ok(diffs)
}

#[tauri::command]
pub fn fs_edit_file(
    project_root: String,
    path: String,
    replacements: Vec<FsEditReplacement>,
) -> Result<FileDiff, String> {
    if replacements.is_empty() {
        return Err("At least one replacement is required".to_string());
    }
    reject_sensitive_path(&path)?;
    let root = canonical_project_root(&project_root)?;
    let absolute = resolve_workspace_path(&project_root, &path)?;
    let old_content = fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
    let new_content = apply_replacements(&old_content, &replacements)?;
    fs::write(&absolute, &new_content).map_err(|error| error.to_string())?;
    Ok(build_file_diff(
        relative_path(&root, &absolute),
        "update",
        Some(old_content),
        Some(new_content),
    ))
}

#[tauri::command]
pub fn fs_apply_patch(project_root: String, patch: String) -> Result<Vec<FileDiff>, String> {
    apply_patch_operations(&project_root, &patch)
}
#[tauri::command]
pub fn fs_stage_preview(
    project_root: String,
    request: FsStagePreviewRequest,
) -> Result<Vec<FileDiff>, String> {
    let root = canonical_project_root(&project_root)?;
    match request {
        FsStagePreviewRequest::Write { path, content } => {
            reject_sensitive_path(&path)?;
            let absolute = resolve_workspace_path(&project_root, &path)?;
            let old_content = if absolute.exists() {
                Some(fs::read_to_string(&absolute).map_err(|error| error.to_string())?)
            } else {
                None
            };
            let operation = if old_content.is_some() {
                "update"
            } else {
                "create"
            };
            Ok(vec![build_file_diff(
                relative_path(&root, &absolute),
                operation,
                old_content,
                Some(content),
            )])
        }
        FsStagePreviewRequest::Edit { path, replacements } => {
            if replacements.is_empty() {
                return Err("At least one replacement is required".to_string());
            }
            reject_sensitive_path(&path)?;
            let absolute = resolve_workspace_path(&project_root, &path)?;
            let old_content = fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
            let new_content = apply_replacements(&old_content, &replacements)?;
            Ok(vec![build_file_diff(
                relative_path(&root, &absolute),
                "update",
                Some(old_content),
                Some(new_content),
            )])
        }
        FsStagePreviewRequest::ApplyPatch { patch } => preview_patch(&project_root, &patch),
        FsStagePreviewRequest::Delete { path } => {
            reject_sensitive_path(&path)?;
            let absolute = resolve_workspace_path(&project_root, &path)?;
            let old_content = fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
            Ok(vec![build_file_diff(
                relative_path(&root, &absolute),
                "delete",
                Some(old_content),
                None,
            )])
        }
    }
}
