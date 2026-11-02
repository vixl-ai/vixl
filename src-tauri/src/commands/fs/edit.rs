use super::diff::build_file_diff;
use super::path::{
    reject_resolved_sensitive_path_unless_allowed, resolve_command_path, ResolvedWorkspacePath,
    WorkspaceRootArg,
};
use super::remote::{self, FsTarget};
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
pub(crate) enum PatchOperation {
    Add { path: String, content: String },
    Update { path: String, content: String },
    Delete { path: String },
}

pub(crate) fn parse_patch(patch: &str) -> Result<Vec<PatchOperation>, String> {
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

pub(crate) fn apply_update_patch<'a>(
    existing: &'a str,
    patched: &'a str,
) -> Result<String, String> {
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

fn member_rel(resolved: &ResolvedWorkspacePath) -> String {
    let rel = resolved.member_relative_path();
    if rel.is_empty() {
        ".".to_string()
    } else {
        rel
    }
}

fn retarget(operation: PatchOperation, path: String) -> PatchOperation {
    match operation {
        PatchOperation::Add { content, .. } => PatchOperation::Add { path, content },
        PatchOperation::Update { content, .. } => PatchOperation::Update { path, content },
        PatchOperation::Delete { .. } => PatchOperation::Delete { path },
    }
}

fn with_member_slug(resolved: &ResolvedWorkspacePath, mut diff: FileDiff) -> FileDiff {
    let Some(slug) = resolved.slug.clone() else {
        return diff;
    };
    if diff.path == slug || diff.path.starts_with(&format!("{slug}/")) {
        return diff;
    }
    diff.path = if diff.path.is_empty() || diff.path == "." {
        slug
    } else {
        format!("{slug}/{}", diff.path)
    };
    diff
}

pub(crate) fn apply_local_member(
    resolved: ResolvedWorkspacePath,
    operation: PatchOperation,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    let root = resolved.root.to_string_lossy().into_owned();
    let operation = retarget(operation, member_rel(&resolved));
    Ok(with_member_slug(
        &resolved,
        apply_one(&root, None, operation, allow_sensitive)?,
    ))
}

pub(crate) fn preview_local_member(
    resolved: ResolvedWorkspacePath,
    operation: PatchOperation,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    let root = resolved.root.to_string_lossy().into_owned();
    let operation = retarget(operation, member_rel(&resolved));
    Ok(with_member_slug(
        &resolved,
        preview_one(&root, None, operation, allow_sensitive)?,
    ))
}

pub(crate) fn stage_preview_local_member(
    resolved: ResolvedWorkspacePath,
    request: FsStagePreviewRequest,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let root = resolved.root.to_string_lossy().into_owned();
    let rel = member_rel(&resolved);
    let request = match request {
        FsStagePreviewRequest::Write { content, .. } => {
            FsStagePreviewRequest::Write { path: rel, content }
        }
        FsStagePreviewRequest::Edit { replacements, .. } => FsStagePreviewRequest::Edit {
            path: rel,
            replacements,
        },
        FsStagePreviewRequest::Delete { .. } => FsStagePreviewRequest::Delete { path: rel },
        FsStagePreviewRequest::ApplyPatch { patch } => FsStagePreviewRequest::ApplyPatch { patch },
    };
    let diffs = stage_preview_local(&root, request, None, allow_sensitive)?;
    Ok(diffs
        .into_iter()
        .map(|diff| with_member_slug(&resolved, diff))
        .collect())
}

pub(crate) fn preview_patch(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();
    for operation in operations {
        diffs.push(preview_one(
            project_root,
            project_roots,
            operation,
            allow_sensitive,
        )?);
    }
    Ok(diffs)
}

fn preview_one(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    operation: PatchOperation,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    match operation {
        PatchOperation::Add { path, content } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "create",
                None,
                Some(content),
            ))
        }
        PatchOperation::Update { path, content } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            let new_content = apply_update_patch(&old_content, &content)?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "update",
                Some(old_content),
                Some(new_content),
            ))
        }
        PatchOperation::Delete { path } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "delete",
                Some(old_content),
                None,
            ))
        }
    }
}

pub(crate) fn apply_patch_operations(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    patch: &str,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    let operations = parse_patch(patch)?;
    let mut diffs = Vec::new();
    for operation in operations {
        diffs.push(apply_one(
            project_root,
            project_roots,
            operation,
            allow_sensitive,
        )?);
    }
    Ok(diffs)
}

fn apply_one(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    operation: PatchOperation,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    match operation {
        PatchOperation::Add { path, content } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            if let Some(parent) = resolved.path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&resolved.path, &content).map_err(|error| error.to_string())?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "create",
                None,
                Some(content),
            ))
        }
        PatchOperation::Update { path, content } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            let new_content = apply_update_patch(&old_content, &content)?;
            fs::write(&resolved.path, &new_content).map_err(|error| error.to_string())?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "update",
                Some(old_content),
                Some(new_content),
            ))
        }
        PatchOperation::Delete { path } => {
            let resolved = resolve_command_path(project_root, project_roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
            let old_content =
                fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
            fs::remove_file(&resolved.path).map_err(|error| error.to_string())?;
            Ok(build_file_diff(
                resolved.reported_path(),
                "delete",
                Some(old_content),
                None,
            ))
        }
    }
}

pub fn fs_edit_file(
    project_root: String,
    path: String,
    replacements: Vec<FsEditReplacement>,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    if replacements.is_empty() {
        return Err("At least one replacement is required".to_string());
    }
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref()) {
        match remote::resolve_target(&project_root, project_roots.as_deref(), &path)? {
            FsTarget::Ssh(_) => {
                return remote::edit_file(
                    &project_root,
                    project_roots.as_deref(),
                    &path,
                    replacements,
                    allow_sensitive,
                );
            }
            FsTarget::Local(resolved) => {
                let rel = resolved.member_relative_path();
                let rel = if rel.is_empty() { ".".to_string() } else { rel };
                return fs_edit_file(
                    resolved.root.to_string_lossy().into_owned(),
                    rel,
                    replacements,
                    None,
                    allow_sensitive,
                );
            }
        }
    }
    let resolved = resolve_command_path(&project_root, project_roots.as_deref(), &path)?;
    reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
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

pub fn fs_apply_patch(
    project_root: String,
    patch: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref()) {
        return remote::apply_patch(
            &project_root,
            project_roots.as_deref(),
            &patch,
            allow_sensitive,
        );
    }
    apply_patch_operations(
        &project_root,
        project_roots.as_deref(),
        &patch,
        allow_sensitive,
    )
}
pub fn fs_stage_preview(
    project_root: String,
    request: FsStagePreviewRequest,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref()) {
        return remote::stage_preview(
            &project_root,
            project_roots.as_deref(),
            request,
            allow_sensitive,
        );
    }
    stage_preview_local(
        &project_root,
        request,
        project_roots.as_deref(),
        allow_sensitive,
    )
}

#[tauri::command(rename = "fs_edit_file")]
pub async fn fs_edit_file_command(
    project_root: String,
    path: String,
    replacements: Vec<FsEditReplacement>,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<FileDiff, String> {
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref())
        && matches!(
            remote::resolve_target(&project_root, project_roots.as_deref(), &path)?,
            remote::FsTarget::Ssh(_)
        )
    {
        return remote::edit_file_await(
            project_root,
            project_roots,
            path,
            replacements,
            allow_sensitive,
        )
        .await;
    }
    super::read::off_the_webview(move || {
        fs_edit_file(
            project_root,
            path,
            replacements,
            project_roots,
            allow_sensitive,
        )
    })
    .await
}

#[tauri::command(rename = "fs_apply_patch")]
pub async fn fs_apply_patch_command(
    project_root: String,
    patch: String,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref()) {
        return remote::apply_patch_await(project_root, project_roots, patch, allow_sensitive)
            .await;
    }
    super::read::off_the_webview(move || {
        fs_apply_patch(project_root, patch, project_roots, allow_sensitive)
    })
    .await
}

#[tauri::command(rename = "fs_stage_preview")]
pub async fn fs_stage_preview_command(
    project_root: String,
    request: FsStagePreviewRequest,
    project_roots: Option<Vec<WorkspaceRootArg>>,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    if remote::uses_ssh_transport(&project_root, project_roots.as_deref()) {
        return remote::stage_preview_await(project_root, project_roots, request, allow_sensitive)
            .await;
    }
    super::read::off_the_webview(move || {
        fs_stage_preview(project_root, request, project_roots, allow_sensitive)
    })
    .await
}

fn stage_preview_local(
    project_root: &str,
    request: FsStagePreviewRequest,
    roots: Option<&[WorkspaceRootArg]>,
    allow_sensitive: Option<bool>,
) -> Result<Vec<FileDiff>, String> {
    match request {
        FsStagePreviewRequest::Write { path, content } => {
            let resolved = resolve_command_path(project_root, roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
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
            let resolved = resolve_command_path(project_root, roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
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
        FsStagePreviewRequest::ApplyPatch { patch } => {
            preview_patch(project_root, roots, &patch, allow_sensitive)
        }
        FsStagePreviewRequest::Delete { path } => {
            let resolved = resolve_command_path(project_root, roots, &path)?;
            reject_resolved_sensitive_path_unless_allowed(&resolved, allow_sensitive)?;
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
    use super::{
        apply_update_patch, build_file_diff, fs_apply_patch, fs_edit_file, fs_stage_preview,
        parse_patch, PatchOperation,
    };
    use crate::commands::fs::path::WorkspaceRootArg;
    use crate::commands::fs::types::{FsEditReplacement, FsStagePreviewRequest};

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

    fn replacement(old_string: &str, new_string: &str) -> FsEditReplacement {
        FsEditReplacement {
            old_string: old_string.to_string(),
            new_string: new_string.to_string(),
            replace_all: false,
        }
    }

    #[test]
    fn edit_honors_allow_sensitive() {
        let dir = tempfile::tempdir().expect("tempdir");
        let env_path = dir.path().join(".env");
        std::fs::write(&env_path, "A=1\n").expect("write env");
        let root = dir.path().to_string_lossy().into_owned();
        let blocked = fs_edit_file(
            root.clone(),
            ".env".to_string(),
            vec![replacement("A=1", "A=2")],
            None,
            None,
        );
        assert_eq!(blocked.expect_err("blocked"), "Sensitive path blocked");
        fs_edit_file(
            root,
            ".env".to_string(),
            vec![replacement("A=1", "A=2")],
            None,
            Some(true),
        )
        .expect("allowed");
        assert_eq!(std::fs::read_to_string(env_path).expect("read"), "A=2\n");
    }

    #[test]
    fn ssh_workspace_previews_and_patches_a_local_member() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("note.txt"), "hello\n").expect("write note");
        std::fs::write(dir.path().join(".env"), "TOKEN=1\n").expect("write env");
        let roots = vec![
            WorkspaceRootArg {
                slug: "local".to_string(),
                path: dir.path().to_string_lossy().into_owned(),
            },
            WorkspaceRootArg {
                slug: "remote".to_string(),
                path: "ssh://aidanhibbard@eva.local/home/aidanhibbard/proj".to_string(),
            },
        ];
        let root = dir.path().to_string_lossy().into_owned();
        let preview = fs_stage_preview(
            root.clone(),
            FsStagePreviewRequest::Write {
                path: "local/note.txt".to_string(),
                content: "next\n".to_string(),
            },
            Some(roots.clone()),
            None,
        )
        .expect("local preview");
        assert_eq!(preview[0].path, "local/note.txt");
        assert_eq!(preview[0].new_content.as_deref(), Some("next\n"));

        let blocked = fs_edit_file(
            root.clone(),
            "local/.env".to_string(),
            vec![replacement("TOKEN=1", "TOKEN=2")],
            Some(roots.clone()),
            None,
        );
        assert_eq!(blocked.expect_err("blocked"), "Sensitive path blocked");
        fs_edit_file(
            root.clone(),
            "local/.env".to_string(),
            vec![replacement("TOKEN=1", "TOKEN=2")],
            Some(roots.clone()),
            Some(true),
        )
        .expect("local edit keeps allow_sensitive");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".env")).expect("read env"),
            "TOKEN=2\n"
        );

        let patched = fs_apply_patch(
            root,
            "*** Begin Patch\n*** Update File: local/note.txt\n@@\n-hello\n+next\n*** End Patch\n"
                .to_string(),
            Some(roots),
            None,
        )
        .expect("local patch");
        assert_eq!(patched[0].path, "local/note.txt");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("note.txt")).expect("read note"),
            "next\n"
        );
    }
}
