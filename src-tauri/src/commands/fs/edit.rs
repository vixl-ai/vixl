use super::diff::build_file_diff;
use super::path::{
    reject_resolved_sensitive_path, resolve_command_path, WorkspaceRootArg,
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
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
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

fn seek_matching_line<'a>(
    old_lines: &[&'a str],
    old_index: &mut usize,
    target: &str,
    result: &mut Vec<&'a str>,
) -> Result<(), String> {
    while *old_index < old_lines.len() && old_lines[*old_index] != target {
        result.push(old_lines[*old_index]);
        *old_index += 1;
    }
    if *old_index >= old_lines.len() {
        return Err("Patch context does not match file contents".to_string());
    }
    Ok(())
}

fn apply_update_patch<'a>(existing: &'a str, patched: &'a str) -> Result<String, String> {
    let mut result: Vec<&'a str> = Vec::new();
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
            seek_matching_line(&old_lines, &mut old_index, removed, &mut result)?;
            old_index += 1;
            patch_index += 1;
            continue;
        }
        if let Some(added) = line.strip_prefix('+') {
            result.push(added);
            patch_index += 1;
            continue;
        }
        seek_matching_line(&old_lines, &mut old_index, line, &mut result)?;
        result.push(line);
        old_index += 1;
        patch_index += 1;
    }

    while old_index < old_lines.len() {
        result.push(old_lines[old_index]);
        old_index += 1;
    }

    if result.is_empty() {
        return Ok(String::new());
    }

    let mut output = result.join("\n");
    if existing.ends_with('\n') {
        output.push('\n');
    }
    Ok(output)
}

pub(crate) fn preview_patch(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
) -> Result<Vec<FileDiff>, String> {
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();

    for operation in operations {
        match operation {
            PatchOperation::Add { path, content } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
                    "create",
                    None,
                    Some(content),
                ));
            }
            PatchOperation::Update { path, content } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                let old_content =
                    fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
                let new_content = apply_update_patch(&old_content, &content)?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
                    "update",
                    Some(old_content),
                    Some(new_content),
                ));
            }
            PatchOperation::Delete { path } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                let old_content =
                    fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
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
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
) -> Result<Vec<FileDiff>, String> {
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();

    for operation in operations {
        match operation {
            PatchOperation::Add { path, content } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                if let Some(parent) = resolved.path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(&resolved.path, &content).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
                    "create",
                    None,
                    Some(content),
                ));
            }
            PatchOperation::Update { path, content } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                let old_content =
                    fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
                let new_content = apply_update_patch(&old_content, &content)?;
                fs::write(&resolved.path, &new_content).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
                    "update",
                    Some(old_content),
                    Some(new_content),
                ));
            }
            PatchOperation::Delete { path } => {
                let resolved = resolve_command_path(project_root, project_roots, &path)?;
                reject_resolved_sensitive_path(&resolved)?;
                let old_content =
                    fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
                fs::remove_file(&resolved.path).map_err(|error| error.to_string())?;
                diffs.push(build_file_diff(
                    resolved.reported_path(),
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
    project_roots: Option<Vec<WorkspaceRootArg>>,
) -> Result<FileDiff, String> {
    if replacements.is_empty() {
        return Err("At least one replacement is required".to_string());
    }
    let resolved = resolve_command_path(&project_root, project_roots.as_deref(), &path)?;
    reject_resolved_sensitive_path(&resolved)?;
    let old_content = fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
    let new_content = apply_replacements(&old_content, &replacements)?;
    fs::write(&resolved.path, &new_content).map_err(|error| error.to_string())?;
    Ok(build_file_diff(
        resolved.reported_path(),
        "update",
        Some(old_content),
        Some(new_content),
    ))
}

#[tauri::command]
pub fn fs_apply_patch(
    project_root: String,
    patch: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
) -> Result<Vec<FileDiff>, String> {
    apply_patch_operations(&project_root, project_roots.as_deref(), &patch)
}
#[tauri::command]
pub fn fs_stage_preview(
    project_root: String,
    request: FsStagePreviewRequest,
    project_roots: Option<Vec<WorkspaceRootArg>>,
) -> Result<Vec<FileDiff>, String> {
    let roots = project_roots.as_deref();
    match request {
        FsStagePreviewRequest::Write { path, content } => {
            let resolved = resolve_command_path(&project_root, roots, &path)?;
            reject_resolved_sensitive_path(&resolved)?;
            let old_content = if resolved.path.exists() {
                Some(fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?)
            } else {
                None
            };
            let operation = if old_content.is_some() {
                "update"
            } else {
                "create"
            };
            Ok(vec![build_file_diff(
                resolved.reported_path(),
                operation,
                old_content,
                Some(content),
            )])
        }
        FsStagePreviewRequest::Edit { path, replacements } => {
            if replacements.is_empty() {
                return Err("At least one replacement is required".to_string());
            }
            let resolved = resolve_command_path(&project_root, roots, &path)?;
            reject_resolved_sensitive_path(&resolved)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            let new_content = apply_replacements(&old_content, &replacements)?;
            Ok(vec![build_file_diff(
                resolved.reported_path(),
                "update",
                Some(old_content),
                Some(new_content),
            )])
        }
        FsStagePreviewRequest::ApplyPatch { patch } => preview_patch(&project_root, roots, &patch),
        FsStagePreviewRequest::Delete { path } => {
            let resolved = resolve_command_path(&project_root, roots, &path)?;
            reject_resolved_sensitive_path(&resolved)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            Ok(vec![build_file_diff(
                resolved.reported_path(),
                "delete",
                Some(old_content),
                None,
            )])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_update_patch, build_file_diff, parse_patch, PatchOperation};

    #[test]
    fn mid_file_hunk_preserves_prefix_and_suffix() {
        let existing = "alpha\nbeta\ngamma\ntarget\nsuffix";
        let patched = "@@\ntarget\n-suffix\n+changed";
        let result = apply_update_patch(existing, patched).expect("mid-file hunk");
        assert_eq!(result, "alpha\nbeta\ngamma\ntarget\nchanged");
    }

    #[test]
    fn multiple_hunks_in_one_file() {
        let existing = "keep\none\nmid\ntwo\nend";
        let patched = "@@\n-one\n+1\n@@\n-two\n+2";
        let result = apply_update_patch(existing, patched).expect("multiple hunks");
        assert_eq!(result, "keep\n1\nmid\n2\nend");
    }

    #[test]
    fn repeated_lines_anchor_at_second_occurrence() {
        let existing = "foo\nfirst\nfoo\nsecond";
        let patched = "@@\nfoo\n-first\n+1\n@@\nfoo\n-second\n+2";
        let result = apply_update_patch(existing, patched).expect("second occurrence");
        assert_eq!(result, "foo\n1\nfoo\n2");
    }

    #[test]
    fn mismatched_hunk_still_errors() {
        let existing = "hello\nworld";
        let patched = "@@\n-missing\n+x";
        let error = apply_update_patch(existing, patched).expect_err("mismatch");
        assert_eq!(error, "Patch context does not match file contents");
    }

    #[test]
    fn mid_file_hunk_keeps_trailing_newline() {
        let existing = "alpha\nbeta\ngamma\n";
        let patched = "@@\n-beta\n+changed";
        let result = apply_update_patch(existing, patched).expect("mid-file hunk");
        assert_eq!(result, "alpha\nchanged\ngamma\n");
    }

    #[test]
    fn eof_append_keeps_trailing_newline() {
        let existing = "alpha\nbeta\n";
        let patched = "@@\nbeta\n+gamma";
        let result = apply_update_patch(existing, patched).expect("eof append");
        assert_eq!(result, "alpha\nbeta\ngamma\n");
    }

    #[test]
    fn blank_line_terminator_survives_mid_file_hunk() {
        let existing = "a\n\n";
        let patched = "@@\n-a\n+b";
        let result = apply_update_patch(existing, patched).expect("blank terminator");
        assert_eq!(result, "b\n\n");
    }

    #[test]
    fn add_file_body_gets_trailing_newline() {
        let operations = parse_patch("*** Add File: foo.txt\n+hello").expect("add file");
        match &operations[..] {
            [PatchOperation::Add { content, .. }] => assert_eq!(content, "hello\n"),
            _ => panic!("expected a single Add operation"),
        }
    }

    #[test]
    fn mid_file_edit_diff_has_no_phantom_last_line() {
        let existing = "alpha\nbeta\ngamma\n";
        let patched = "@@\n-beta\n+changed";
        let new_content = apply_update_patch(existing, patched).expect("mid-file hunk");
        let diff = build_file_diff(
            "file.txt".to_string(),
            "update",
            Some(existing.to_string()),
            Some(new_content),
        );
        for hunk in &diff.hunks {
            let changes: Vec<_> = hunk
                .lines
                .iter()
                .filter(|line| line.kind != "context")
                .collect();
            let phantom_last_line = changes.len() == 2
                && changes[0].kind == "remove"
                && changes[1].kind == "add"
                && changes[0].content == changes[1].content;
            assert!(
                !phantom_last_line,
                "hunk whose only change is an identical remove and add"
            );
            for line in &changes {
                assert_ne!(line.content.as_str(), "gamma");
            }
        }
    }
}
