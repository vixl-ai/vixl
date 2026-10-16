use std::path::Path;

use serde::{Deserialize, Serialize};

use super::walk::walk_builder;
use crate::commands::fs::{canonical_project_root, workspace_roots_from_args, WorkspaceRootArg};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGlobRequest {
    pub project_root: String,
    pub pattern: String,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub project_roots: Option<Vec<WorkspaceRootArg>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobFileEntry {
    pub path: String,
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

    let scopes = glob_scopes(&request)?;
    let limit = request.limit.unwrap_or(500) as usize;
    let pattern = request.pattern.clone();

    tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let mut truncated = false;
        for scope in scopes {
            let remaining = limit.saturating_sub(files.len());
            if remaining == 0 {
                truncated = true;
                break;
            }
            let partial = collect_glob_files(&scope.root, &pattern, remaining)?;
            for mut entry in partial.files {
                if let Some(prefix) = &scope.prefix {
                    entry.path = if entry.path.is_empty() {
                        prefix.clone()
                    } else {
                        format!("{prefix}/{}", entry.path)
                    };
                }
                files.push(entry);
                if files.len() >= limit {
                    truncated = true;
                    break;
                }
            }
            truncated = truncated || partial.truncated;
            if truncated {
                break;
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(WorkspaceGlobResult { files, truncated })
    })
    .await
    .map_err(|error| format!("Glob search failed: {error}"))?
}

struct GlobScope {
    root: std::path::PathBuf,
    prefix: Option<String>,
}

fn glob_scopes(request: &WorkspaceGlobRequest) -> Result<Vec<GlobScope>, String> {
    if let Some(args) = request
        .project_roots
        .as_deref()
        .filter(|roots| !roots.is_empty())
    {
        let roots = workspace_roots_from_args(args)?;
        return Ok(roots
            .into_iter()
            .filter(|root| !root.path.as_os_str().is_empty())
            .map(|root| GlobScope {
                prefix: Some(root.slug),
                root: root.path,
            })
            .collect());
    }

    Ok(vec![GlobScope {
        root: canonical_project_root(&request.project_root)?,
        prefix: None,
    }])
}

fn collect_glob_files(
    root: &Path,
    pattern: &str,
    limit: usize,
) -> Result<WorkspaceGlobResult, String> {
    let collect_limit = limit.saturating_add(1);
    let walker = walk_builder(root, Some(pattern), None, true)?;
    let mut files = Vec::new();
    let mut truncated = false;

    for entry in walker.build() {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }

        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };

        files.push(GlobFileEntry {
            path: rel.to_string_lossy().to_string(),
        });

        if files.len() >= collect_limit {
            truncated = true;
            break;
        }
    }

    if truncated {
        files.truncate(limit);
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(WorkspaceGlobResult { files, truncated })
}
