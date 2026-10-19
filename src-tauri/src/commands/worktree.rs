use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::AppHandle;

use super::git_binary::git_binary;
use super::paths::user_vixl_dir;
use super::registry::{fleet_projects, roots_match, slugify_or_fallback, FleetProject};

#[path = "worktree_copy_plans.rs"]
mod worktree_copy_plans;

const WORKTREE_NAME_MAX_LEN: usize = 64;
const WORKTREES_DIR: &str = "worktrees";
const PARENT_SLUG_WALK_LIMIT: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeAddResult {
    pub path: String,
    pub branch: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeParentMatch {
    pub parent_project_id: String,
    pub branch: String,
}

fn run_git(root_path: &str, args: &[&str]) -> Result<String, String> {
    let git = git_binary()?;
    let output = Command::new(&git)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .arg("-C")
        .arg(root_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
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

pub fn validate_worktree_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Worktree name is required".to_string());
    }
    if trimmed.len() > WORKTREE_NAME_MAX_LEN {
        return Err("Worktree name must be 64 characters or fewer".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Worktree name cannot contain path separators".to_string());
    }
    if trimmed.chars().all(|c| c == '.') {
        return Err("Worktree name is invalid".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-'))
    {
        return Err("Worktree name must be a lowercase slug (a-z, 0-9, hyphen)".to_string());
    }
    Ok(trimmed.to_string())
}

fn parent_dir_slug(raw: &str) -> String {
    slugify_or_fallback(raw, "project")
}

fn filesystem_slug_from_path(root_path: &str) -> String {
    let name = Path::new(root_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project");
    parent_dir_slug(name)
}

fn main_checkout_slug(matched: &FleetProject, projects: &[FleetProject]) -> String {
    let mut current = matched;
    let mut seen = HashSet::new();
    seen.insert(current.id.clone());
    for _ in 0..PARENT_SLUG_WALK_LIMIT {
        let Some(link) = current.worktree.as_ref() else {
            return current.slug.clone();
        };
        if !seen.insert(link.parent_id.clone()) {
            return matched.slug.clone();
        }
        let Some(parent) = projects.iter().find(|project| project.id == link.parent_id) else {
            return matched.slug.clone();
        };
        current = parent;
    }
    matched.slug.clone()
}

pub fn parent_slug_among(root_path: &str, projects: &[FleetProject]) -> String {
    let Some(matched) = projects
        .iter()
        .find(|project| roots_match(&project.root_path, root_path))
    else {
        return filesystem_slug_from_path(root_path);
    };
    parent_dir_slug(&main_checkout_slug(matched, projects))
}

fn parent_slug_for_root(app: &AppHandle, root_path: &str) -> String {
    match fleet_projects(app) {
        Ok(projects) => parent_slug_among(root_path, &projects),
        Err(_) => filesystem_slug_from_path(root_path),
    }
}

fn validate_base_ref(base_ref: &str) -> Result<&str, String> {
    let trimmed = base_ref.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.contains('\0')
        || trimmed.contains(char::is_whitespace)
    {
        return Err("Invalid base ref".to_string());
    }
    Ok(trimmed)
}

fn resolve_reported_path(cwd: &Path, reported: &str) -> PathBuf {
    let path = Path::new(reported.trim());
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    dunce::canonicalize(&absolute).unwrap_or(absolute)
}

fn paths_equal(left: &str, right: &str) -> bool {
    roots_match(left, right)
}

fn path_is_within(parent: &Path, child: &Path) -> bool {
    let Ok(parent) = dunce::canonicalize(parent) else {
        return false;
    };
    let child = dunce::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    child.starts_with(&parent)
}

pub fn parse_worktree_porcelain(output: &str) -> Vec<GitWorktreeEntry> {
    let mut entries = Vec::new();
    let mut path: Option<String> = None;
    let mut branch = None;
    let mut bare = false;
    let mut detached = false;

    let flush = |entries: &mut Vec<GitWorktreeEntry>,
                 path: &mut Option<String>,
                 branch: &mut Option<String>,
                 bare: &mut bool,
                 detached: &mut bool| {
        if let Some(path) = path.take() {
            entries.push(GitWorktreeEntry {
                path,
                branch: branch.take(),
                bare: *bare,
                detached: *detached,
            });
            *bare = false;
            *detached = false;
        }
    };

    for line in output.lines() {
        let line = line.trim_end_matches('\r').trim_end();
        if line.is_empty() {
            flush(
                &mut entries,
                &mut path,
                &mut branch,
                &mut bare,
                &mut detached,
            );
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            flush(
                &mut entries,
                &mut path,
                &mut branch,
                &mut bare,
                &mut detached,
            );
            path = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix("branch ") {
            let name = rest.strip_prefix("refs/heads/").unwrap_or(rest);
            if !name.is_empty() {
                branch = Some(name.to_string());
            }
            detached = false;
            continue;
        }
        if line == "detached" {
            detached = true;
            branch = None;
            continue;
        }
        if line == "bare" {
            bare = true;
        }
    }

    flush(
        &mut entries,
        &mut path,
        &mut branch,
        &mut bare,
        &mut detached,
    );
    entries
}

fn branch_exists(root_path: &str, branch: &str) -> bool {
    let spec = format!("refs/heads/{branch}");
    run_git(root_path, &["show-ref", "--verify", "--quiet", &spec]).is_ok()
}

fn resolve_worktree_parent_checkout(path: &str) -> Result<Option<(PathBuf, String)>, String> {
    let cwd = PathBuf::from(path);
    let git_dir = match run_git(path, &["rev-parse", "--absolute-git-dir"]) {
        Ok(value) if !value.is_empty() => resolve_reported_path(&cwd, &value),
        _ => match run_git(path, &["rev-parse", "--git-dir"]) {
            Ok(value) if !value.is_empty() => resolve_reported_path(&cwd, &value),
            _ => return Ok(None),
        },
    };
    let common_dir = match run_git(path, &["rev-parse", "--git-common-dir"]) {
        Ok(value) if !value.is_empty() => resolve_reported_path(&cwd, &value),
        _ => return Ok(None),
    };

    if paths_equal(&git_dir.to_string_lossy(), &common_dir.to_string_lossy()) {
        return Ok(None);
    }

    let main_checkout = if common_dir.file_name().is_some_and(|name| name == ".git") {
        match common_dir.parent() {
            Some(parent) => parent.to_path_buf(),
            None => return Ok(None),
        }
    } else {
        common_dir
    };

    let branch = run_git(path, &["branch", "--show-current"]).unwrap_or_default();
    Ok(Some((main_checkout, branch)))
}

pub fn detect_worktree_parent_among(
    path: &str,
    projects: &[FleetProject],
) -> Result<Option<WorktreeParentMatch>, String> {
    let Some((main_checkout, branch)) = resolve_worktree_parent_checkout(path)? else {
        return Ok(None);
    };
    let main_checkout = main_checkout.to_string_lossy().to_string();
    let parent = projects
        .iter()
        .find(|project| roots_match(&project.root_path, &main_checkout));
    Ok(parent.map(|project| WorktreeParentMatch {
        parent_project_id: project.id.clone(),
        branch,
    }))
}

pub fn git_worktree_add_in_dir(
    root_path: &str,
    name: &str,
    base_ref: Option<&str>,
    user_vixl_dir: &Path,
    parent_slug: &str,
) -> Result<GitWorktreeAddResult, String> {
    let name = validate_worktree_name(name)?;
    let base = match base_ref {
        Some(value) => validate_base_ref(value)?.to_string(),
        None => "HEAD".to_string(),
    };
    let branch = format!("vixl/{name}");
    if branch_exists(root_path, &branch) {
        return Err(format!("Branch {branch} already exists"));
    }

    let parent_slug = parent_dir_slug(parent_slug);
    let worktrees_root = user_vixl_dir.join(WORKTREES_DIR);
    fs::create_dir_all(worktrees_root.join(&parent_slug)).map_err(|error| error.to_string())?;
    let worktrees_canon =
        dunce::canonicalize(&worktrees_root).map_err(|error| error.to_string())?;
    let target = worktrees_canon.join(&parent_slug).join(&name);
    if !path_is_within(&worktrees_canon, &target) {
        return Err("Worktree path must stay under the vixl worktrees directory".to_string());
    }
    if target.exists() {
        return Err(format!(
            "Worktree directory already exists: {}",
            target.display()
        ));
    }

    let target_str = target.to_string_lossy().to_string();
    run_git(
        root_path,
        &["worktree", "add", "-b", &branch, &target_str, &base],
    )?;

    if let Err(error) = worktree_copy_plans::copy_vixl_plans_into(root_path, &target) {
        log::warn!("Failed to copy .vixl/plans into worktree: {error}");
    }

    let path = dunce::canonicalize(&target)
        .unwrap_or(target)
        .to_string_lossy()
        .to_string();
    Ok(GitWorktreeAddResult { path, branch, name })
}

#[tauri::command]
pub fn git_worktree_list(root_path: String) -> Result<Vec<GitWorktreeEntry>, String> {
    let output = run_git(&root_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_porcelain(&output))
}

#[tauri::command]
pub fn git_worktree_add(
    app: AppHandle,
    root_path: String,
    name: String,
    base_ref: Option<String>,
) -> Result<GitWorktreeAddResult, String> {
    let vixl = user_vixl_dir(&app)?;
    let parent_slug = parent_slug_for_root(&app, &root_path);
    git_worktree_add_in_dir(&root_path, &name, base_ref.as_deref(), &vixl, &parent_slug)
}

#[tauri::command]
pub fn git_worktree_remove(
    root_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    let entries = git_worktree_list(root_path.clone())?;
    let Some(matched) = entries
        .iter()
        .find(|entry| paths_equal(&entry.path, &worktree_path))
    else {
        return Err("Path is not a worktree of this repository".to_string());
    };

    let remove_path = matched.path.clone();
    if force {
        run_git(&root_path, &["worktree", "remove", "--force", &remove_path])?;
    } else {
        run_git(&root_path, &["worktree", "remove", &remove_path])?;
    }
    Ok(())
}

#[tauri::command]
pub fn worktree_detect_parent(
    app: AppHandle,
    path: String,
) -> Result<Option<WorktreeParentMatch>, String> {
    let projects = fleet_projects(&app).unwrap_or_default();
    detect_worktree_parent_among(&path, &projects)
}
