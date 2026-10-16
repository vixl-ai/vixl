use std::io;
use std::path::Path;

use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use serde::{Deserialize, Serialize};

use super::walk::walk_builder;
use crate::commands::fs::{
    canonical_project_root, resolve_command_path, workspace_roots_from_args, WorkspaceRootArg,
};

#[derive(Debug, Clone, Deserialize)]
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
    pub max_results: Option<u32>,
    #[serde(default)]
    pub regex: Option<bool>,
    #[serde(default)]
    pub whole_word: Option<bool>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
    #[serde(default)]
    pub project_roots: Option<Vec<WorkspaceRootArg>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub path: String,
    pub line_number: u32,
    pub line: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrepResult {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

fn byte_offset_to_column(line: &str, byte_offset: usize) -> u32 {
    let mut capped = byte_offset.min(line.len());
    while capped > 0 && !line.is_char_boundary(capped) {
        capped -= 1;
    }
    (line[..capped].chars().count() as u32).saturating_add(1)
}

#[tauri::command]
pub async fn workspace_grep(request: WorkspaceGrepRequest) -> Result<WorkspaceGrepResult, String> {
    if request.pattern.trim().is_empty() {
        return Err("Search pattern is required".to_string());
    }

    let scopes = grep_scopes(&request)?;

    tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();
        let mut truncated = false;
        let max_results = request.max_results.unwrap_or(200) as usize;
        for scope in scopes {
            let remaining = max_results.saturating_sub(matches.len());
            if remaining == 0 {
                truncated = true;
                break;
            }
            let mut scoped = request.clone();
            scoped.max_results = Some(remaining as u32);
            let partial = collect_grep_matches(&scope.root, &scope.search_path, &scoped)?;
            for mut item in partial.matches {
                if let Some(prefix) = &scope.prefix {
                    item.path = if item.path.is_empty() {
                        prefix.clone()
                    } else {
                        format!("{prefix}/{}", item.path)
                    };
                }
                matches.push(item);
                if matches.len() >= max_results {
                    truncated = true;
                    break;
                }
            }
            truncated = truncated || partial.truncated;
            if truncated {
                break;
            }
        }
        Ok(WorkspaceGrepResult { matches, truncated })
    })
    .await
    .map_err(|error| format!("Grep search failed: {error}"))?
}

struct GrepScope {
    root: std::path::PathBuf,
    search_path: std::path::PathBuf,
    prefix: Option<String>,
}

fn grep_scopes(request: &WorkspaceGrepRequest) -> Result<Vec<GrepScope>, String> {
    if let Some(args) = request
        .project_roots
        .as_deref()
        .filter(|roots| !roots.is_empty())
    {
        if let Some(path) = request.path.as_deref() {
            let resolved = resolve_command_path(&request.project_root, Some(args), path)?;
            return Ok(vec![GrepScope {
                root: resolved.root,
                search_path: resolved.path,
                prefix: resolved.slug,
            }]);
        }

        let roots = workspace_roots_from_args(args)?;
        return Ok(roots
            .into_iter()
            .filter(|root| !root.path.as_os_str().is_empty())
            .map(|root| GrepScope {
                prefix: Some(root.slug),
                search_path: root.path.clone(),
                root: root.path,
            })
            .collect());
    }

    let root = canonical_project_root(&request.project_root)?;
    let search_path = match request.path.as_deref() {
        Some(path) => resolve_command_path(&request.project_root, None, path)?.path,
        None => root.clone(),
    };
    Ok(vec![GrepScope {
        root,
        search_path,
        prefix: None,
    }])
}

fn collect_grep_matches(
    root: &Path,
    search_path: &Path,
    request: &WorkspaceGrepRequest,
) -> Result<WorkspaceGrepResult, String> {
    let case_insensitive = request.case_insensitive.unwrap_or(false);
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .fixed_strings(!request.regex.unwrap_or(true))
        .word(request.whole_word.unwrap_or(false))
        .build(&request.pattern)
        .map_err(|error| error.to_string())?;

    let include = request
        .glob
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let exclude = request
        .exclude_glob
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let walker = walk_builder(search_path, include, exclude, case_insensitive)?;
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let max_results = request.max_results.unwrap_or(200) as usize;
    let mut matches = Vec::new();
    let mut truncated = false;

    for entry in walker.build() {
        if truncated {
            break;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }

        let file_path = entry.path();
        let Ok(rel) = file_path.strip_prefix(root) else {
            continue;
        };
        let rel_path = rel.to_string_lossy().to_string();

        let _ = searcher.search_path(
            &matcher,
            file_path,
            UTF8(|line_number, line| {
                if truncated {
                    return Ok(false);
                }

                let line_text = line.trim_end_matches('\n').to_string();
                let mut found = false;
                matcher
                    .find_iter(line_text.as_bytes(), |matched| {
                        found = true;
                        matches.push(GrepMatch {
                            path: rel_path.clone(),
                            line_number: line_number as u32,
                            line: line_text.clone(),
                            start_column: Some(byte_offset_to_column(&line_text, matched.start())),
                            end_column: Some(byte_offset_to_column(&line_text, matched.end())),
                        });
                        if matches.len() >= max_results {
                            truncated = true;
                            return false;
                        }
                        true
                    })
                    .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;

                if !found {
                    matches.push(GrepMatch {
                        path: rel_path.clone(),
                        line_number: line_number as u32,
                        line: line_text,
                        start_column: None,
                        end_column: None,
                    });
                    if matches.len() >= max_results {
                        truncated = true;
                    }
                }

                Ok(!truncated)
            }),
        );
    }

    Ok(WorkspaceGrepResult { matches, truncated })
}
