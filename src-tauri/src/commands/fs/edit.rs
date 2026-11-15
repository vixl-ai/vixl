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

/// Characters of an unanchored hunk line quoted in a mismatch error.
const CONTEXT_SNIPPET_LIMIT: usize = 60;

fn context_mismatch(target: &str) -> String {
    let total = target.chars().count();
    let quoted: String = target.chars().take(CONTEXT_SNIPPET_LIMIT).collect();
    let ellipsis = if total > CONTEXT_SNIPPET_LIMIT {
        "…"
    } else {
        ""
    };
    format!("Patch context does not match file contents: no line matching \"{quoted}{ellipsis}\"")
}

fn find_next(old_lines: &[&str], from: usize, target: &str) -> Option<usize> {
    (from..old_lines.len()).find(|&index| old_lines[index] == target)
}

fn seek_matching_line<'a>(
    old_lines: &[&'a str],
    old_index: &mut usize,
    target: &str,
    result: &mut Vec<&'a str>,
) -> Result<(), String> {
    match find_next(old_lines, *old_index, target) {
        Some(index) => {
            result.extend_from_slice(&old_lines[*old_index..index]);
            *old_index = index;
            Ok(())
        }
        None => Err(context_mismatch(target)),
    }
}

/// Locate a context line at or after `from`. Hunk context is matched verbatim first, then with a single
/// leading space dropped, because a context line may be written either as the file's own text or with
/// the marker a model emits ahead of it. Verbatim wins so hunks that anchor today keep anchoring
/// identically; callers emit the file's line, never the patch's, so a marker cannot leak into output.
fn resolve_context<'a>(old_lines: &[&'a str], from: usize, raw: &str) -> Option<(&'a str, usize)> {
    find_next(old_lines, from, raw)
        .or_else(|| {
            raw.strip_prefix(' ')
                .and_then(|unmarked| find_next(old_lines, from, unmarked))
        })
        .map(|index| (old_lines[index], index))
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
        let Some((context_line, matched_at)) = resolve_context(&old_lines, old_index, line) else {
            return Err(context_mismatch(line));
        };
        result.extend_from_slice(&old_lines[old_index..matched_at]);
        result.push(context_line);
        old_index = matched_at + 1;
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
            let new_content = apply_update_patch(&old_content, &content)
                .map_err(|error| format!("{}: {error}", resolved.reported_path()))?;
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
            let new_content = apply_update_patch(&old_content, &content)
                .map_err(|error| format!("{}: {error}", resolved.reported_path()))?;
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
        assert!(error.starts_with("Patch context does not match file contents"));
    }

    #[test]
    fn marked_context_matches_without_leaking_the_marker() {
        let existing = "alpha\n    leg_rx = [9.2, 8.4]\nbeta\n";
        let patched = "@@\n alpha\n     leg_rx = [9.2, 8.4]\n-beta\n+gamma";
        let result = apply_update_patch(existing, patched).expect("marked context");
        assert_eq!(result, "alpha\n    leg_rx = [9.2, 8.4]\ngamma\n");
    }

    #[test]
    fn marked_blank_context_matches_an_empty_line() {
        let existing = "a\n\nc\n";
        let patched = "@@\n a\n \n-c\n+C";
        let result = apply_update_patch(existing, patched).expect("marked blank context");
        assert_eq!(result, "a\n\nC\n");
    }

    #[test]
    fn verbatim_context_wins_over_the_marker_fallback() {
        let existing = "keep\n b\nmid\nb\ntarget\n";
        let patched = "@@\n b\n-mid\n+X";
        let result = apply_update_patch(existing, patched).expect("verbatim anchor");
        assert_eq!(result, "keep\n b\nX\nb\ntarget\n");
    }

    #[test]
    fn marked_context_absent_in_both_forms_still_errors() {
        let existing = "hello\nworld";
        let patched = "@@\n   missing\n-hello\n+x";
        let error = apply_update_patch(existing, patched).expect_err("marked mismatch");
        assert!(error.starts_with("Patch context does not match file contents"));
        assert!(error.contains("missing"));
    }

    #[test]
    fn marked_hunk_with_line_numbers_applies_to_indented_code() {
        let existing = concat!(
            "leg_secs = [\n",
            "    (6.05, 0.0, 47.5), (6.15, -0.25, 40.0),\n",
            "    (6.55, 0.0, 16.0), (6.6, 0.3, 11.0),\n",
            "]\n",
            "leg_rx = [9.2, 8.4, 7.0]\n",
            "leg_ry = [9.6, 8.7, 7.3]\n",
            "leg_r = path_loft(\"CHR_leg_R\", P(leg_secs), R(leg_rx), R(leg_ry))\n",
        );
        let patched = concat!(
            "@@ -6,7 +6,7 @@\n",
            "     (6.55, 0.0, 16.0), (6.6, 0.3, 11.0),\n",
            " ]\n",
            "-leg_rx = [9.2, 8.4, 7.0]\n",
            "+leg_rx = [9.4, 8.4, 7.0]\n",
            "-leg_ry = [9.6, 8.7, 7.3]\n",
            "+leg_ry = [9.8, 8.7, 7.3]\n",
            " leg_r = path_loft(\"CHR_leg_R\", P(leg_secs), R(leg_rx), R(leg_ry))\n",
        );
        let result = apply_update_patch(existing, patched).expect("marked hunk");
        assert!(result.starts_with("leg_secs = [\n    (6.05, 0.0, 47.5)"));
        assert!(result.contains("\n    (6.55, 0.0, 16.0), (6.6, 0.3, 11.0),\n]\n"));
        assert!(result.contains("leg_rx = [9.4, 8.4, 7.0]\nleg_ry = [9.8, 8.7, 7.3]\n"));
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
    fn add_file_body_keeps_interior_blank_lines() {
        for patch in [
            "*** Add File: p.py\n+a = [\n+\n+    1,\n+]",
            "*** Add File: p.py\n+a = [\n\n+    1,\n+]",
        ] {
            let operations = parse_patch(patch).expect("add file with blank line");
            match &operations[..] {
                [PatchOperation::Add { content, .. }] => {
                    assert_eq!(content, "a = [\n\n    1,\n]\n");
                }
                _ => panic!("expected a single Add operation"),
            }
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
