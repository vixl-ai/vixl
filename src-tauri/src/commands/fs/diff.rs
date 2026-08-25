use similar::{ChangeTag, TextDiff};

use super::types::{DiffLine, FileDiff, FileDiffHunk};

pub(crate) fn build_file_diff(
    path: String,
    operation: &str,
    old_content: Option<String>,
    new_content: Option<String>,
) -> FileDiff {
    let old = old_content.as_deref().unwrap_or("");
    let new = new_content.as_deref().unwrap_or("");
    let hunks = build_hunks(old, new);
    FileDiff {
        path,
        operation: operation.to_string(),
        old_content,
        new_content,
        hunks,
    }
}

pub(crate) fn strip_line_ending(value: &str) -> String {
    value
        .trim_end_matches('\n')
        .trim_end_matches('\r')
        .to_string()
}

pub(crate) fn range_start_1based(start: usize, len: usize) -> u32 {
    if len == 0 {
        start as u32
    } else {
        (start + 1) as u32
    }
}

pub fn build_hunks(old: &str, new: &str) -> Vec<FileDiffHunk> {
    if old == new {
        return vec![];
    }

    let diff = TextDiff::from_lines(old, new);
    let mut hunks = Vec::new();

    for group in diff.grouped_ops(3) {
        if group.is_empty() {
            continue;
        }

        let first = &group[0];
        let last = &group[group.len() - 1];
        let old_len = last.old_range().end.saturating_sub(first.old_range().start);
        let new_len = last.new_range().end.saturating_sub(first.new_range().start);

        let mut lines = Vec::new();
        for op in &group {
            for change in diff.iter_changes(op) {
                let kind = match change.tag() {
                    ChangeTag::Equal => "context",
                    ChangeTag::Delete => "remove",
                    ChangeTag::Insert => "add",
                };
                lines.push(DiffLine {
                    kind: kind.to_string(),
                    content: strip_line_ending(change.value()),
                });
            }
        }

        if lines.is_empty() {
            continue;
        }

        hunks.push(FileDiffHunk {
            old_start: range_start_1based(first.old_range().start, old_len),
            new_start: range_start_1based(first.new_range().start, new_len),
            lines,
        });
    }

    hunks
}
