use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use uuid::Uuid;

use super::paths::user_vixl_dir;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct FleetProject {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub root_path: String,
    pub last_opened: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectsRegistry {
    version: u8,
    projects: Vec<FleetProject>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ActiveProject {
    project_id: Option<String>,
}

fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?.join("projects.json"))
}

fn active_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(user_vixl_dir(app)?.join("active-project.json"))
}

pub(crate) fn fleet_projects(app: &AppHandle) -> Result<Vec<FleetProject>, String> {
    Ok(read_registry(app)?.projects)
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

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
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

    let canonical = absolute
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path {path_arg}: {e}"))?;

    if !canonical.is_dir() {
        return Err(format!("Not a directory: {}", canonical.display()));
    }

    Ok(canonical)
}

fn add_or_update_project(
    app: &AppHandle,
    name: String,
    root_path: String,
) -> Result<FleetProject, String> {
    let mut registry = read_registry(app)?;
    if let Some(existing) = registry
        .projects
        .iter_mut()
        .find(|p| p.root_path == root_path)
    {
        existing.name = name;
        existing.last_opened = chrono_now();
        let project = existing.clone();
        write_registry(app, &registry)?;
        return Ok(project);
    }

    let project = FleetProject {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        slug: slugify(&name),
        root_path,
        last_opened: chrono_now(),
    };
    registry.projects.push(project.clone());
    registry
        .projects
        .sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    write_registry(app, &registry)?;
    Ok(project)
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

#[tauri::command]
pub fn registry_update_project_root(
    app: AppHandle,
    project_id: String,
    root_path: String,
) -> Result<FleetProject, String> {
    let mut registry = read_registry(&app)?;
    let project = registry
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    project.root_path = root_path;
    project.last_opened = chrono_now();
    let updated = project.clone();
    write_registry(&app, &registry)?;
    Ok(updated)
}

#[tauri::command]
pub fn registry_remove_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let mut registry = read_registry(&app)?;
    registry.projects.retain(|p| p.id != project_id);
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
pub fn get_active_project(app: AppHandle) -> Result<Option<String>, String> {
    let path = active_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let active: ActiveProject = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(active.project_id)
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}
