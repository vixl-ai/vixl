use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use uuid::Uuid;

use super::paths::user_vixl_dir;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorktreeLink {
    pub parent_id: String,
    pub branch: String,
    pub managed: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct FleetProject {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub root_path: String,
    pub last_opened: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<WorktreeLink>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct FleetProjectGroup {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub member_slugs: Vec<String>,
    pub last_opened: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectsRegistry {
    version: u8,
    projects: Vec<FleetProject>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GroupsRegistry {
    version: u8,
    groups: Vec<FleetProjectGroup>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ActiveProject {
    project_id: Option<String>,
}

fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?.join("projects.json"))
}

fn groups_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?.join("project-groups.json"))
}

fn active_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?.join("active-project.json"))
}

pub(crate) fn fleet_projects(app: &AppHandle) -> Result<Vec<FleetProject>, String> {
    Ok(read_registry(app)?.projects)
}

pub(crate) fn fleet_groups(app: &AppHandle) -> Result<Vec<FleetProjectGroup>, String> {
    Ok(read_groups_registry(app)?.groups)
}

fn read_registry(app: &AppHandle) -> Result<ProjectsRegistry, String> {
    let path = projects_path(app)?;
    if !path.exists() {
        return Ok(ProjectsRegistry {
            version: 1,
            projects: vec![],
        });
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_registry(app: &AppHandle, registry: &ProjectsRegistry) -> Result<(), String> {
    let path = projects_path(app)?;
    let content = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn read_groups_registry(app: &AppHandle) -> Result<GroupsRegistry, String> {
    let path = groups_path(app)?;
    if !path.exists() {
        return Ok(GroupsRegistry {
            version: 1,
            groups: vec![],
        });
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_groups_registry(app: &AppHandle, registry: &GroupsRegistry) -> Result<(), String> {
    let path = groups_path(app)?;
    let content = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub(crate) fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

pub(crate) fn slugify_or_fallback(name: &str, fallback: &str) -> String {
    let slug = slugify(name);
    if slug.is_empty() {
        fallback.to_string()
    } else {
        slug
    }
}

#[cfg(test)]
pub(crate) fn unique_project_slug(name: &str, projects: &[FleetProject]) -> String {
    unique_fleet_slug(
        name,
        "project",
        projects.iter().map(|project| project.slug.as_str()),
    )
}

pub(crate) fn unique_group_slug(
    name: &str,
    projects: &[FleetProject],
    groups: &[FleetProjectGroup],
) -> String {
    unique_fleet_slug(
        name,
        "group",
        projects
            .iter()
            .map(|project| project.slug.as_str())
            .chain(groups.iter().map(|group| group.slug.as_str())),
    )
}

fn unique_fleet_slug<'a>(
    name: &str,
    empty_fallback: &str,
    occupied: impl IntoIterator<Item = &'a str>,
) -> String {
    let occupied: HashSet<&str> = occupied.into_iter().collect();
    let base = slugify_or_fallback(name, empty_fallback);
    if base != "_home_" && !occupied.contains(base.as_str()) {
        return base;
    }
    let mut n = 2u32;
    loop {
        let candidate = format!("{base}-{n}");
        if !occupied.contains(candidate.as_str()) {
            return candidate;
        }
        n = n.saturating_add(1);
        if n == u32::MAX {
            return format!("{base}-{n}");
        }
    }
}

fn is_valid_member_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug
            .chars()
            .all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-'))
}

pub(crate) fn default_group_name(member_slugs: &[String], projects: &[FleetProject]) -> String {
    member_slugs
        .iter()
        .map(|slug| {
            projects
                .iter()
                .find(|project| project.slug == *slug)
                .map(|project| project.name.as_str())
                .unwrap_or(slug.as_str())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn resolved_group_name(
    name: Option<&str>,
    member_slugs: &[String],
    projects: &[FleetProject],
) -> String {
    match name.map(str::trim).filter(|value| !value.is_empty()) {
        Some(provided) => provided.to_string(),
        None => default_group_name(member_slugs, projects),
    }
}

fn member_sets_equal(left: &[String], right: &[String]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let left_set: HashSet<&str> = left.iter().map(String::as_str).collect();
    let right_set: HashSet<&str> = right.iter().map(String::as_str).collect();
    left_set == right_set
}

fn validate_member_slugs(member_slugs: &[String], projects: &[FleetProject]) -> Result<(), String> {
    if member_slugs.len() < 2 {
        return Err("Group must include at least two projects".to_string());
    }
    let mut seen = HashSet::new();
    for slug in member_slugs {
        if !is_valid_member_slug(slug) {
            return Err(format!("Invalid project slug: {slug}"));
        }
        if !seen.insert(slug.as_str()) {
            return Err(format!("Duplicate member slug: {slug}"));
        }
        if !projects.iter().any(|project| project.slug == *slug) {
            return Err(format!("Unknown project slug: {slug}"));
        }
    }
    Ok(())
}

pub(crate) fn roots_match(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    match (
        dunce::canonicalize(Path::new(left)),
        dunce::canonicalize(Path::new(right)),
    ) {
        (Ok(left_canonical), Ok(right_canonical)) => left_canonical == right_canonical,
        _ => false,
    }
}

fn normalize_root_path(root_path: String) -> String {
    dunce::canonicalize(&root_path)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or(root_path)
}

#[cfg(test)]
pub(crate) fn upsert_fleet_project(
    projects: &mut Vec<FleetProject>,
    name: String,
    root_path: String,
) -> FleetProject {
    upsert_fleet_project_occupied(projects, name, root_path, &[])
}

#[cfg(test)]
pub(crate) fn upsert_fleet_project_occupied(
    projects: &mut Vec<FleetProject>,
    name: String,
    root_path: String,
    occupied_group_slugs: &[String],
) -> FleetProject {
    upsert_fleet_project_occupied_inner(projects, name, root_path, occupied_group_slugs)
}

fn upsert_fleet_project_occupied_inner(
    projects: &mut Vec<FleetProject>,
    name: String,
    root_path: String,
    occupied_group_slugs: &[String],
) -> FleetProject {
    let root_path = normalize_root_path(root_path);
    if let Some(index) = projects
        .iter()
        .position(|project| roots_match(&project.root_path, &root_path))
    {
        let existing = &mut projects[index];
        existing.last_opened = chrono_now();
        existing.root_path = root_path;
        let project = existing.clone();
        projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
        return project;
    }

    let project = FleetProject {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        slug: unique_fleet_slug(
            &name,
            "project",
            projects
                .iter()
                .map(|project| project.slug.as_str())
                .chain(occupied_group_slugs.iter().map(String::as_str)),
        ),
        root_path,
        last_opened: chrono_now(),
        worktree: None,
    };
    projects.push(project.clone());
    projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    project
}

#[tauri::command]
pub fn registry_list_projects(app: AppHandle) -> Result<Vec<FleetProject>, String> {
    Ok(read_registry(&app)?.projects)
}

pub fn resolve_launch_path(path_arg: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path_arg);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };

    let canonical = dunce::canonicalize(&absolute)
        .map_err(|e| format!("Failed to resolve path {path_arg}: {e}"))?;

    if !canonical.is_dir() {
        return Err(format!("Not a directory: {}", canonical.display()));
    }

    Ok(canonical)
}

pub(crate) fn add_or_update_project(
    app: &AppHandle,
    name: String,
    root_path: String,
) -> Result<FleetProject, String> {
    let mut registry = read_registry(app)?;
    let groups = read_groups_registry(app).unwrap_or(GroupsRegistry {
        version: 1,
        groups: vec![],
    });
    let occupied: Vec<String> = groups
        .groups
        .iter()
        .map(|group| group.slug.clone())
        .collect();
    let project =
        upsert_fleet_project_occupied_inner(&mut registry.projects, name, root_path, &occupied);
    let vixl = user_vixl_dir(app).ok();
    sync_project_worktree_link(&mut registry.projects, &project.id, vixl.as_deref());
    write_registry(app, &registry)?;
    registry
        .projects
        .iter()
        .find(|entry| entry.id == project.id)
        .cloned()
        .ok_or_else(|| "Project not found after upsert".to_string())
}

pub fn open_project_at_path(app: &AppHandle, root_path: PathBuf) -> Result<FleetProject, String> {
    let name = root_path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("project")
        .to_string();
    let root_path_str = root_path.to_string_lossy().to_string();
    let project = add_or_update_project(app, name, root_path_str)?;
    registry_set_active_project(app.clone(), Some(project.id.clone()))?;
    Ok(project)
}

#[tauri::command(rename = "open_project_at_path")]
pub fn open_project_at_path_command(
    app: AppHandle,
    root_path: PathBuf,
) -> Result<FleetProject, String> {
    open_project_at_path(&app, root_path)
}

#[tauri::command]
pub fn registry_add_project(
    app: AppHandle,
    name: String,
    root_path: String,
) -> Result<FleetProject, String> {
    add_or_update_project(&app, name, root_path)
}

pub fn apply_project_root_update(
    projects: &mut [FleetProject],
    project_id: &str,
    root_path: String,
    user_vixl_dir: Option<&Path>,
) -> Result<FleetProject, String> {
    {
        let project = projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "Project not found".to_string())?;
        project.root_path = root_path;
        project.last_opened = chrono_now();
    }
    sync_project_worktree_link(projects, project_id, user_vixl_dir);
    projects
        .iter()
        .find(|project| project.id == project_id)
        .cloned()
        .ok_or_else(|| "Project not found".to_string())
}

#[tauri::command]
pub fn registry_update_project_root(
    app: AppHandle,
    project_id: String,
    root_path: String,
) -> Result<FleetProject, String> {
    let mut registry = read_registry(&app)?;
    let vixl = user_vixl_dir(&app).ok();
    let updated = apply_project_root_update(
        &mut registry.projects,
        &project_id,
        root_path,
        vixl.as_deref(),
    )?;
    write_registry(&app, &registry)?;
    Ok(updated)
}

#[tauri::command]
pub fn registry_remove_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let mut registry = read_registry(&app)?;
    registry.projects.retain(|p| p.id != project_id);
    clear_worktree_links_to_parent(&mut registry.projects, &project_id);
    write_registry(&app, &registry)?;

    let active = get_active_project(app.clone())?;
    if active.as_deref() == Some(project_id.as_str()) {
        registry_set_active_project(app, None)?;
    }

    Ok(())
}

#[tauri::command]
pub fn registry_set_active_project(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<(), String> {
    let path = active_path(&app)?;
    let active = ActiveProject { project_id };
    let content = serde_json::to_string_pretty(&active).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn registry_list_groups(app: AppHandle) -> Result<Vec<FleetProjectGroup>, String> {
    Ok(read_groups_registry(&app)?.groups)
}

fn add_or_reuse_group(
    groups: &mut Vec<FleetProjectGroup>,
    projects: &[FleetProject],
    member_slugs: Vec<String>,
    name: Option<&str>,
) -> Result<FleetProjectGroup, String> {
    validate_member_slugs(&member_slugs, projects)?;
    if let Some(index) = groups
        .iter()
        .position(|group| member_sets_equal(&group.member_slugs, &member_slugs))
    {
        groups[index].last_opened = chrono_now();
        let existing = groups[index].clone();
        groups.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
        return Ok(existing);
    }

    let resolved_name = resolved_group_name(name, &member_slugs, projects);
    let group = FleetProjectGroup {
        id: Uuid::new_v4().to_string(),
        name: resolved_name.clone(),
        slug: unique_group_slug(&resolved_name, projects, groups),
        member_slugs,
        last_opened: chrono_now(),
    };
    groups.push(group.clone());
    groups.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(group)
}

fn update_group_in_place(
    groups: &mut Vec<FleetProjectGroup>,
    projects: &[FleetProject],
    group_id: &str,
    name: String,
    member_slugs: Vec<String>,
) -> Result<FleetProjectGroup, String> {
    validate_member_slugs(&member_slugs, projects)?;
    let group = groups
        .iter_mut()
        .find(|group| group.id == group_id)
        .ok_or_else(|| "Group not found".to_string())?;
    group.name = name;
    group.member_slugs = member_slugs;
    group.last_opened = chrono_now();
    let updated = group.clone();
    groups.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(updated)
}

fn remove_group_by_id(groups: &mut Vec<FleetProjectGroup>, group_id: &str) {
    groups.retain(|group| group.id != group_id);
}

#[cfg(test)]
pub(crate) fn upsert_fleet_group(
    groups: &mut Vec<FleetProjectGroup>,
    projects: &[FleetProject],
    member_slugs: Vec<String>,
    name: Option<&str>,
) -> Result<FleetProjectGroup, String> {
    add_or_reuse_group(groups, projects, member_slugs, name)
}

#[cfg(test)]
pub(crate) fn apply_group_update(
    groups: &mut Vec<FleetProjectGroup>,
    projects: &[FleetProject],
    group_id: &str,
    name: String,
    member_slugs: Vec<String>,
) -> Result<FleetProjectGroup, String> {
    update_group_in_place(groups, projects, group_id, name, member_slugs)
}

#[cfg(test)]
pub(crate) fn remove_fleet_group(groups: &mut Vec<FleetProjectGroup>, group_id: &str) {
    remove_group_by_id(groups, group_id)
}

#[tauri::command]
pub fn registry_add_group(
    app: AppHandle,
    member_slugs: Vec<String>,
    name: Option<String>,
) -> Result<FleetProjectGroup, String> {
    let projects = read_registry(&app)?.projects;
    let mut registry = read_groups_registry(&app)?;
    let group = add_or_reuse_group(
        &mut registry.groups,
        &projects,
        member_slugs,
        name.as_deref(),
    )?;
    write_groups_registry(&app, &registry)?;
    Ok(group)
}

#[tauri::command]
pub fn registry_update_group(
    app: AppHandle,
    group_id: String,
    name: String,
    member_slugs: Vec<String>,
) -> Result<FleetProjectGroup, String> {
    let projects = read_registry(&app)?.projects;
    let mut registry = read_groups_registry(&app)?;
    let updated = update_group_in_place(
        &mut registry.groups,
        &projects,
        &group_id,
        name,
        member_slugs,
    )?;
    write_groups_registry(&app, &registry)?;
    Ok(updated)
}

#[tauri::command]
pub fn registry_remove_group(app: AppHandle, group_id: String) -> Result<(), String> {
    let mut registry = read_groups_registry(&app)?;
    remove_group_by_id(&mut registry.groups, &group_id);
    write_groups_registry(&app, &registry)?;
    Ok(())
}

#[tauri::command]
pub fn get_active_project(app: AppHandle) -> Result<Option<String>, String> {
    let path = active_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let active: ActiveProject = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(active.project_id)
}

pub fn sync_project_worktree_link(
    projects: &mut [FleetProject],
    project_id: &str,
    user_vixl_dir: Option<&Path>,
) {
    let Some(project) = projects.iter().find(|project| project.id == project_id) else {
        return;
    };
    let root = project.root_path.clone();
    let detected = super::worktree::detect_worktree_parent_among(&root, projects)
        .ok()
        .flatten();
    let Some(project) = projects.iter_mut().find(|project| project.id == project_id) else {
        return;
    };
    match detected {
        Some(parent) => {
            let managed = match user_vixl_dir {
                Some(dir) => super::worktree::is_managed_worktree_path(&root, dir),
                None => project
                    .worktree
                    .as_ref()
                    .is_some_and(|link| link.managed && link.parent_id == parent.parent_project_id),
            };
            project.worktree = Some(WorktreeLink {
                parent_id: parent.parent_project_id,
                branch: parent.branch,
                managed,
            });
        }
        None => {
            project.worktree = None;
        }
    }
}

pub fn clear_worktree_links_to_parent(projects: &mut [FleetProject], parent_id: &str) {
    for project in projects.iter_mut() {
        if project
            .worktree
            .as_ref()
            .is_some_and(|link| link.parent_id == parent_id)
        {
            project.worktree = None;
        }
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

#[cfg(test)]
mod tests;
