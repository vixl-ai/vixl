use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::fs::{canonical_project_root, resolve_workspace_path};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrepRequest {
    pub project_root: String,
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub glob: Option<String>,
    #[serde(default)]
    pub case_insensitive: Option<bool>,
    #[serde(default)]
    pub context: Option<u32>,
    #[serde(default)]
    pub max_results: Option<u32>,
    /// When omitted, defaults to true (regex). When false, pass `--fixed-strings`.
    #[serde(default)]
    pub regex: Option<bool>,
    #[serde(default)]
    pub whole_word: Option<bool>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub path: String,
    pub line_number: u32,
    pub line: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_before: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_after: Option<Vec<String>>,
    /// 1-based character column (UTF-8 aware) from rg submatch byte start.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,
    /// 1-based character column (UTF-8 aware) from rg submatch byte end (exclusive).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrepResult {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

/// Convert a UTF-8 byte offset within `line` to a 1-based character column.
fn byte_offset_to_column(line: &str, byte_offset: usize) -> u32 {
    let mut capped = byte_offset.min(line.len());
    while capped > 0 && !line.is_char_boundary(capped) {
        capped -= 1;
    }
    (line[..capped].chars().count() as u32).saturating_add(1)
}

fn exclude_glob_arg(pattern: &str) -> String {
    let trimmed = pattern.trim();
    if trimmed.starts_with('!') {
        trimmed.to_string()
    } else {
        format!("!{trimmed}")
    }
}

#[tauri::command]
pub async fn workspace_grep(request: WorkspaceGrepRequest) -> Result<WorkspaceGrepResult, String> {
    if request.pattern.trim().is_empty() {
        return Err("Search pattern is required".to_string());
    }

    let root = canonical_project_root(&request.project_root)?;
    let search_path = match request.path.as_deref() {
        Some(path) => resolve_workspace_path(&request.project_root, path)?,
        None => root.clone(),
    };

    let mut command = Command::new("rg");
    command
        .arg("--json")
        .arg("--regexp")
        .arg(&request.pattern)
        .arg("--no-heading");

    // Default true: harness callers omit this and keep regex behavior.
    if !request.regex.unwrap_or(true) {
        command.arg("--fixed-strings");
    }

    if request.whole_word.unwrap_or(false) {
        command.arg("--word-regexp");
    }

    if request.case_insensitive.unwrap_or(false) {
        command.arg("--ignore-case");
    }

    if let Some(glob) = request
        .glob
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.arg("--glob").arg(glob);
    }

    if let Some(exclude) = request
        .exclude_glob
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.arg("--glob").arg(exclude_glob_arg(exclude));
    }

    if let Some(context) = request.context {
        command.arg("--context").arg(context.to_string());
    }

    // Do not pass rg --max-count (per-file). Enforce max_results only when parsing.
    let max_results = request.max_results.unwrap_or(200);
    command.arg(search_path);

    let output = command
        .output()
        .await
        .map_err(|error| format!("Failed to run rg: {error}"))?;

    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("rg failed with status {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matches = Vec::new();
    let mut truncated = false;
    let max_results_usize = max_results as usize;

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: serde_json::Value =
            serde_json::from_str(line).map_err(|error| error.to_string())?;
        let kind = parsed
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if kind != "match" {
            continue;
        }
        let data = parsed
            .get("data")
            .ok_or_else(|| "rg output missing data field".to_string())?;
        let path_text = data
            .get("path")
            .and_then(|value| value.get("text"))
            .and_then(|value| value.as_str())
            .ok_or_else(|| "rg output missing path".to_string())?;
        let line_number = data
            .get("line_number")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32;
        let line_text = data
            .get("lines")
            .and_then(|value| value.get("text"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim_end_matches('\n')
            .to_string();

        let rel_path = std::path::Path::new(path_text)
            .strip_prefix(&root)
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|_| path_text.to_string());

        let submatches = data
            .get("submatches")
            .and_then(|value| value.as_array())
            .filter(|items| !items.is_empty());

        match submatches {
            Some(items) => {
                for submatch in items {
                    let start_byte = submatch
                        .get("start")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0) as usize;
                    let end_byte = submatch
                        .get("end")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0) as usize;
                    matches.push(GrepMatch {
                        path: rel_path.clone(),
                        line_number,
                        line: line_text.clone(),
                        context_before: None,
                        context_after: None,
                        start_column: Some(byte_offset_to_column(&line_text, start_byte)),
                        end_column: Some(byte_offset_to_column(&line_text, end_byte)),
                    });
                    if matches.len() >= max_results_usize {
                        truncated = true;
                        break;
                    }
                }
            }
            None => {
                matches.push(GrepMatch {
                    path: rel_path,
                    line_number,
                    line: line_text,
                    context_before: None,
                    context_after: None,
                    start_column: None,
                    end_column: None,
                });
                if matches.len() >= max_results_usize {
                    truncated = true;
                }
            }
        }

        if truncated {
            break;
        }
    }

    Ok(WorkspaceGrepResult { matches, truncated })
}
