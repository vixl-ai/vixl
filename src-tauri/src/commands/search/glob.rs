use std::path::Path;

use serde::{Deserialize, Serialize};

use super::walk::walk_builder;
use crate::commands::fs::{
    canonical_project_root, parse_ssh_project_root, uses_ssh_transport, workspace_roots_from_args,
    WorkspaceRootArg,
};
use crate::commands::ssh::is_ssh_root;

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

    if uses_ssh_transport(&request.project_root, request.project_roots.as_deref()) {
        return glob_with_ssh(request).await;
    }

    let scopes = glob_scopes(&request)?;
    let limit = request.limit.unwrap_or(500) as usize;
    let (scopes, pattern) = if request
        .project_roots
        .as_deref()
        .is_some_and(|roots| !roots.is_empty())
    {
        restrict_glob_scopes(scopes, request.pattern)
    } else {
        (scopes, request.pattern)
    };

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

async fn glob_with_ssh(request: WorkspaceGlobRequest) -> Result<WorkspaceGlobResult, String> {
    let limit = request.limit.unwrap_or(500) as usize;
    if let Some(args) = request
        .project_roots
        .as_deref()
        .filter(|roots| !roots.is_empty())
    {
        let slugs: Vec<&str> = args
            .iter()
            .map(|arg| arg.slug.trim())
            .filter(|slug| !slug.is_empty())
            .collect();
        let (only_slug, pattern) = scoped_member_glob(&slugs, &request.pattern);
        let mut files = Vec::new();
        let mut truncated = false;
        for arg in args {
            if only_slug
                .as_deref()
                .is_some_and(|slug| arg.slug.trim() != slug)
            {
                continue;
            }
            let remaining = limit.saturating_sub(files.len());
            if remaining == 0 {
                truncated = true;
                break;
            }
            if arg.path.trim().starts_with("ssh://") {
                let ssh = parse_ssh_project_root(&arg.path)?;
                let partial =
                    super::ssh::glob_ssh(&ssh, &pattern, Some(arg.slug.trim()), remaining).await?;
                files.extend(partial.files);
                truncated = truncated || partial.truncated;
            } else if !arg.path.trim().is_empty() {
                let root = canonical_project_root(&arg.path)?;
                let pattern = pattern.clone();
                let prefix = arg.slug.trim().to_string();
                let partial = tokio::task::spawn_blocking(move || {
                    collect_glob_files(&root, &pattern, remaining)
                })
                .await
                .map_err(|error| format!("Glob search failed: {error}"))??;
                for mut entry in partial.files {
                    if !prefix.is_empty() {
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
            }
            if truncated {
                break;
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        return Ok(WorkspaceGlobResult { files, truncated });
    }
    if is_ssh_root(&request.project_root) {
        let ssh = parse_ssh_project_root(&request.project_root)?;
        return super::ssh::glob_ssh(&ssh, &request.pattern, None, limit).await;
    }
    Err("SSH search root is required".to_string())
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

fn scoped_member_glob(slugs: &[&str], pattern: &str) -> (Option<String>, String) {
    let (first, remainder) = match pattern.split_once('/') {
        Some((first, rest)) => (first, rest),
        None => (pattern, ""),
    };
    if first.is_empty() || !slugs.contains(&first) {
        return (None, pattern.to_string());
    }
    let narrowed = if remainder.is_empty() {
        "**/*".to_string()
    } else {
        remainder.to_string()
    };
    (Some(first.to_string()), narrowed)
}

fn restrict_glob_scopes(mut scopes: Vec<GlobScope>, pattern: String) -> (Vec<GlobScope>, String) {
    let slugs: Vec<&str> = scopes
        .iter()
        .filter_map(|scope| scope.prefix.as_deref())
        .collect();
    let (only, narrowed) = scoped_member_glob(&slugs, &pattern);
    let Some(slug) = only else {
        return (scopes, pattern);
    };
    let Some(index) = scopes
        .iter()
        .position(|scope| scope.prefix.as_deref() == Some(slug.as_str()))
    else {
        return (scopes, pattern);
    };
    let scope = scopes.swap_remove(index);
    (vec![scope], narrowed)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mixed_workspace_glob_includes_the_local_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("hello.txt"), "hi").expect("write");
        let result = workspace_glob(WorkspaceGlobRequest {
            project_root: "ssh://johnny@vixl-glob.example/tmp/remote".into(),
            pattern: "hello.txt".into(),
            limit: Some(1),
            project_roots: Some(vec![
                WorkspaceRootArg {
                    slug: "local".into(),
                    path: dir.path().to_string_lossy().to_string(),
                },
                WorkspaceRootArg {
                    slug: "remote".into(),
                    path: "ssh://johnny@vixl-glob.example/tmp/remote".into(),
                },
            ]),
        })
        .await
        .expect("glob");
        assert!(
            result
                .files
                .iter()
                .any(|file| file.path == "local/hello.txt"),
            "local root missing: {:?}",
            result.files
        );
    }

    #[tokio::test]
    async fn mixed_workspace_glob_scopes_a_slug_prefix() {
        let local = tempfile::tempdir().expect("local");
        let other = tempfile::tempdir().expect("other");
        std::fs::write(local.path().join("hello.txt"), "hi").expect("write");
        std::fs::write(other.path().join("hello.txt"), "hi").expect("write");
        let result = workspace_glob(WorkspaceGlobRequest {
            project_root: "ssh://johnny@vixl-glob.example/tmp/remote".into(),
            pattern: "local/hello.txt".into(),
            limit: None,
            project_roots: Some(vec![
                WorkspaceRootArg {
                    slug: "local".into(),
                    path: local.path().to_string_lossy().to_string(),
                },
                WorkspaceRootArg {
                    slug: "other".into(),
                    path: other.path().to_string_lossy().to_string(),
                },
                WorkspaceRootArg {
                    slug: "remote".into(),
                    path: "ssh://johnny@vixl-glob.example/tmp/remote".into(),
                },
            ]),
        })
        .await
        .expect("glob");
        let paths: Vec<&str> = result.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, vec!["local/hello.txt"]);
    }
}
