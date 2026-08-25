use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

use super::fs::canonical_project_root;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGlobRequest {
    pub project_root: String,
    pub pattern: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobFileEntry {
    pub path: String,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGlobResult {
    pub files: Vec<GlobFileEntry>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn workspace_glob(request: WorkspaceGlobRequest) -> Result<WorkspaceGlobResult, String> {
    if request.pattern.trim().is_empty() {
        return Err("Glob pattern is required".to_string());
    }

    let root = canonical_project_root(&request.project_root)?;
    let limit = request.limit.unwrap_or(500) as usize;
    let collect_limit = limit.saturating_add(1);

    let mut child = Command::new("rg")
        .arg("--files")
        .arg("--iglob")
        .arg(&request.pattern)
        .arg(&root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to run rg: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture rg stdout".to_string())?;
    let stderr = child.stderr.take();
    let mut lines = BufReader::new(stdout).lines();
    let mut files = Vec::new();
    let mut truncated = false;

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("Failed to read rg output: {error}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let path = std::path::PathBuf::from(trimmed);
        let Ok(rel) = path.strip_prefix(&root) else {
            continue;
        };

        files.push(GlobFileEntry {
            path: rel.to_string_lossy().to_string(),
            modified_ms: None,
        });

        if files.len() >= collect_limit {
            truncated = true;
            let _ = child.start_kill();
            break;
        }
    }

    if truncated {
        let _ = child.wait().await;
        files.truncate(limit);
    } else {
        let status = child
            .wait()
            .await
            .map_err(|error| format!("Failed to wait for rg: {error}"))?;

        // rg exits 1 when no files match the glob; treat as empty success.
        if !status.success() && status.code() != Some(1) {
            let mut stderr_text = String::new();
            if let Some(stderr) = stderr {
                let _ = BufReader::new(stderr)
                    .read_to_string(&mut stderr_text)
                    .await;
            }
            let stderr_text = stderr_text.trim().to_string();
            return Err(if stderr_text.is_empty() {
                format!("rg failed with status {status}")
            } else {
                stderr_text
            });
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(WorkspaceGlobResult { files, truncated })
}
