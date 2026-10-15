use sha2::{Digest, Sha256};

use crate::commands::registry::{FleetProject, FleetProjectGroup};
use tauri::AppHandle;

pub const HOME_PROJECT_ID: &str = "_home_";

pub fn resolve_project_id(
    slug: &str,
    project_root: &str,
    projects: &[FleetProject],
    groups: &[FleetProjectGroup],
) -> String {
    if slug == HOME_PROJECT_ID {
        return HOME_PROJECT_ID.to_string();
    }
    if groups.iter().any(|group| group.slug == slug) {
        return format!("group:{slug}");
    }
    if let Some(project) = projects.iter().find(|p| p.root_path == project_root) {
        return project.id.clone();
    }
    if let Some(project) = projects.iter().find(|p| p.slug == slug) {
        return project.id.clone();
    }
    unmatched_project_id(slug, project_root)
}

pub fn resolve_project_id_for_app(app: &AppHandle, slug: &str, project_root: &str) -> String {
    let projects = crate::commands::registry::fleet_projects(app).unwrap_or_default();
    let groups = crate::commands::registry::fleet_groups(app).unwrap_or_default();
    resolve_project_id(slug, project_root, &projects, &groups)
}

fn unmatched_project_id(slug: &str, project_root: &str) -> String {
    let digest = Sha256::digest(format!("{slug}\n{project_root}").as_bytes());
    format!("unmatched-{:x}", digest)
}
