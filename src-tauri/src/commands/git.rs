use std::process::Command;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub is_repo: bool,
    pub current_branch: Option<String>,
}

fn run_git(root_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        // trim_end only: porcelain status lines can start with a space (e.g. " M path").
        return Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err(format!(
            "git {} failed with status {}",
            args.join(" "),
            output.status
        ))
    } else {
        Err(stderr)
    }
}

fn is_git_repo(root_path: &str) -> bool {
    run_git(root_path, &["rev-parse", "--is-inside-work-tree"])
        .map(|value| value == "true")
        .unwrap_or(false)
}

#[tauri::command]
pub fn git_repo_info(root_path: String) -> Result<GitRepoInfo, String> {
    if !is_git_repo(&root_path) {
        return Ok(GitRepoInfo {
            is_repo: false,
            current_branch: None,
        });
    }

    let current_branch = run_git(&root_path, &["branch", "--show-current"])
        .ok()
        .filter(|branch| !branch.is_empty());

    Ok(GitRepoInfo {
        is_repo: true,
        current_branch,
    })
}

#[tauri::command]
pub fn git_list_branches(root_path: String) -> Result<Vec<String>, String> {
    if !is_git_repo(&root_path) {
        return Ok(vec![]);
    }

    let output = run_git(&root_path, &["branch", "--format=%(refname:short)"])?;

    let mut branches: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
        .collect();

    branches.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
    branches.dedup();

    Ok(branches)
}

#[tauri::command]
pub fn git_checkout_branch(root_path: String, branch: String) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }

    if !is_git_repo(&root_path) {
        return Err("Not a git repository".to_string());
    }

    run_git(&root_path, &["checkout", branch.trim()])?;
    Ok(())
}

#[tauri::command]
pub fn git_branch_create(
    project_root: String,
    name: String,
    checkout: Option<bool>,
) -> Result<(), String> {
    let branch = name.trim();
    if branch.is_empty() {
        return Err("Branch name is required".to_string());
    }

    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    if checkout.unwrap_or(true) {
        run_git(&project_root, &["checkout", "-b", branch])?;
    } else {
        run_git(&project_root, &["branch", branch])?;
    }

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub hash: String,
    pub message: String,
    pub output: String,
}

#[tauri::command]
pub async fn git_commit(
    project_root: String,
    message: String,
    paths: Vec<String>,
) -> Result<GitCommitResult, String> {
    let commit_message = message.trim();
    if commit_message.is_empty() {
        return Err("Commit message is required".to_string());
    }

    if paths.is_empty() {
        return Err(
      "At least one path is required — use git_status to identify changed files before committing. Staging all files with git add -A is not permitted.".to_string(),
    );
    }

    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        run_git_async(&project_root, &["add", "--", trimmed]).await?;
    }

    let output = run_git_async(&project_root, &["commit", "-m", commit_message]).await?;
    let hash = run_git_async(&project_root, &["rev-parse", "HEAD"]).await?;

    Ok(GitCommitResult {
        hash,
        message: commit_message.to_string(),
        output,
    })
}

use tokio::process::Command as AsyncCommand;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unstaged_status: Option<String>,
    pub is_untracked: bool,
    pub is_ignored: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub branch: Option<String>,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowFileResult {
    pub content: String,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResult {
    pub commits: Vec<GitLogEntry>,
}

async fn run_git_async(root_path: &str, args: &[&str]) -> Result<String, String> {
    let output = AsyncCommand::new("git")
        .arg("-C")
        .arg(root_path)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        // trim_end only: porcelain status lines can start with a space (e.g. " M path").
        return Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err(format!(
            "git {} failed with status {}",
            args.join(" "),
            output.status
        ))
    } else {
        Err(stderr)
    }
}

fn parse_status_code(code: char) -> Option<String> {
    if code == ' ' {
        return None;
    }
    Some(code.to_string())
}

pub fn parse_porcelain_status(line: &str) -> Option<GitStatusEntry> {
    if line.len() < 4 {
        return None;
    }
    let x = line.chars().next()?;
    let y = line.chars().nth(1)?;
    if x == '?' && y == '?' {
        let path = line[3..].trim().to_string();
        return Some(GitStatusEntry {
            path,
            old_path: None,
            staged_status: None,
            unstaged_status: Some("?".to_string()),
            is_untracked: true,
            is_ignored: false,
        });
    }
    if x == '!' && y == '!' {
        let path = line[3..].trim().to_string();
        return Some(GitStatusEntry {
            path,
            old_path: None,
            staged_status: None,
            unstaged_status: Some("!".to_string()),
            is_untracked: false,
            is_ignored: true,
        });
    }

    let rest = line[3..].trim();
    let (path, old_path) = if let Some((left, right)) = rest.split_once(" -> ") {
        (right.trim().to_string(), Some(left.trim().to_string()))
    } else {
        (rest.to_string(), None)
    };

    Some(GitStatusEntry {
        path,
        old_path,
        staged_status: parse_status_code(x),
        unstaged_status: parse_status_code(y),
        is_untracked: false,
        is_ignored: false,
    })
}

#[tauri::command]
pub async fn git_status(project_root: String) -> Result<GitStatusResult, String> {
    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    let branch = run_git_async(&project_root, &["branch", "--show-current"])
        .await
        .ok()
        .filter(|value| !value.is_empty());

    // --ignored matches VS Code explorer (dimmed gitignored paths like node_modules).
    let output = run_git_async(&project_root, &["status", "--porcelain=1", "--ignored"]).await?;
    let entries = output.lines().filter_map(parse_porcelain_status).collect();

    Ok(GitStatusResult { branch, entries })
}

#[tauri::command]
pub async fn git_diff(
    project_root: String,
    path: Option<String>,
    staged: Option<bool>,
) -> Result<GitDiffResult, String> {
    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    let mut args = vec!["diff"];
    if staged.unwrap_or(false) {
        args.push("--cached");
    }
    if let Some(file_path) = path.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("--");
        args.push(file_path.trim());
    }

    let diff = run_git_async(&project_root, &args).await?;
    Ok(GitDiffResult { diff })
}

#[tauri::command]
pub async fn git_show_file(
    project_root: String,
    path: String,
) -> Result<GitShowFileResult, String> {
    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }
    if trimmed.contains('\0') || trimmed.starts_with('-') {
        return Err("Invalid path".to_string());
    }

    // Do not trim file content: trailing newlines matter for accurate diffs.
    let spec = format!("HEAD:{trimmed}");
    let output = AsyncCommand::new("git")
        .arg("-C")
        .arg(&project_root)
        .args(["show", &spec])
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        return Ok(GitShowFileResult {
            content: String::from_utf8_lossy(&output.stdout).to_string(),
            exists: true,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("does not exist")
        || stderr.contains("exists on disk")
        || stderr.contains("bad revision")
        || stderr.contains("invalid object name")
    {
        return Ok(GitShowFileResult {
            content: String::new(),
            exists: false,
        });
    }

    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        Err(format!("git show failed with status {}", output.status))
    } else {
        Err(message)
    }
}

#[tauri::command]
pub async fn git_log(project_root: String, limit: Option<u32>) -> Result<GitLogResult, String> {
    if !is_git_repo(&project_root) {
        return Err("Not a git repository".to_string());
    }

    let count_arg = format!("-{}", limit.unwrap_or(20).max(1));
    let pretty_arg = "--pretty=format:%H%x1f%s%x1f%an%x1f%aI".to_string();
    let output = run_git_async(&project_root, &["log", &count_arg, &pretty_arg]).await?;

    let commits = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let hash = parts.next()?.to_string();
            let subject = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let date = parts.next()?.to_string();
            Some(GitLogEntry {
                hash,
                subject,
                author,
                date,
            })
        })
        .collect();

    Ok(GitLogResult { commits })
}
