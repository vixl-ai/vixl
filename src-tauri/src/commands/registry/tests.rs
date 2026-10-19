use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use super::{
    apply_group_update, apply_project_root_update, default_group_name, normalize_root_path,
    remove_fleet_group, unique_group_slug, unique_project_slug, upsert_fleet_group,
    upsert_fleet_project, upsert_fleet_project_occupied, FleetProject, FleetProjectGroup,
    WorktreeLink,
};

struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("vixl-registry-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp registry root");
        Self { path }
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn sample(id: &str, name: &str, slug: &str, root: &str) -> FleetProject {
    FleetProject {
        id: id.to_string(),
        name: name.to_string(),
        slug: slug.to_string(),
        root_path: root.to_string(),
        last_opened: "1".to_string(),
        worktree: None,
    }
}

fn sample_group(id: &str, name: &str, slug: &str, members: &[&str]) -> FleetProjectGroup {
    FleetProjectGroup {
        id: id.to_string(),
        name: name.to_string(),
        slug: slug.to_string(),
        member_slugs: members.iter().map(|member| member.to_string()).collect(),
        last_opened: "1".to_string(),
    }
}

#[test]
fn unique_slug_appends_number_when_taken() {
    let existing = vec![sample("1", "Game", "game", "/tmp/game-a")];
    assert_eq!(unique_project_slug("Game", &existing), "game-2");
    let both = vec![
        sample("1", "Game", "game", "/tmp/game-a"),
        sample("2", "Game", "game-2", "/tmp/game-b"),
    ];
    assert_eq!(unique_project_slug("Game", &both), "game-3");
}

#[test]
fn unique_group_slug_avoids_project_and_group_slugs() {
    let projects = vec![sample("1", "API", "api", "/tmp/api")];
    let groups = vec![sample_group("g1", "api, web", "api-web", &["api", "web"])];
    assert_eq!(unique_group_slug("API", &projects, &groups), "api-2");
    assert_eq!(
        unique_group_slug("api, web", &projects, &groups),
        "api-web-2"
    );
}

#[test]
fn default_group_name_is_csv_of_member_names() {
    let projects = vec![
        sample("1", "api", "api", "/tmp/api"),
        sample("2", "web", "web", "/tmp/web"),
        sample("3", "worker", "worker", "/tmp/worker"),
    ];
    assert_eq!(
        default_group_name(
            &["api".to_string(), "web".to_string(), "worker".to_string()],
            &projects
        ),
        "api, web, worker"
    );
}

#[test]
fn unique_slug_does_not_emit_reserved_home() {
    assert_ne!(unique_project_slug("_home_", &[]), "_home_");
    let existing = vec![sample("1", "Home", "_home_", "/tmp/home")];
    assert_ne!(unique_project_slug("home", &existing), "_home_");
}

#[test]
fn upsert_existing_reuses_id_slug_and_name() {
    let root = TempRoot::new("existing");
    let root_str = root.path.to_string_lossy().to_string();
    let mut projects = Vec::new();
    let created = upsert_fleet_project(&mut projects, "Game".to_string(), root_str.clone());
    let dotted = root.path.join(".");
    let again = upsert_fleet_project(
        &mut projects,
        "Other Name".to_string(),
        dotted.to_string_lossy().to_string(),
    );
    assert_eq!(projects.len(), 1);
    assert_eq!(again.id, created.id);
    assert_eq!(again.slug, created.slug);
    assert_eq!(again.name, "Game");
    assert_eq!(again.slug, "game");
}

#[test]
fn upsert_create_new_assigns_unique_slug() {
    let first_root = TempRoot::new("game-a");
    let second_root = TempRoot::new("game-b");
    let mut projects = Vec::new();
    let first = upsert_fleet_project(
        &mut projects,
        "Game".to_string(),
        first_root.path.to_string_lossy().to_string(),
    );
    let second = upsert_fleet_project(
        &mut projects,
        "Game".to_string(),
        second_root.path.to_string_lossy().to_string(),
    );
    assert_ne!(first.id, second.id);
    assert_eq!(first.slug, "game");
    assert_eq!(second.slug, "game-2");
    assert_eq!(projects.len(), 2);
}

#[test]
fn normalize_root_path_strips_trailing_slash() {
    let root = TempRoot::new("slash");
    let with_slash = format!("{}{}", root.path.display(), std::path::MAIN_SEPARATOR);
    let normalized = normalize_root_path(with_slash);
    assert!(
        !normalized.ends_with('/') && !normalized.ends_with('\\'),
        "normalized path should not end with a slash: {normalized}"
    );
}

fn sample_projects() -> Vec<FleetProject> {
    vec![
        sample("1", "api", "api", "/tmp/api"),
        sample("2", "web", "web", "/tmp/web"),
        sample("3", "worker", "worker", "/tmp/worker"),
    ]
}

#[test]
fn upsert_project_avoids_existing_group_slug() {
    let root = TempRoot::new("api");
    let mut projects = Vec::new();
    let occupied = vec!["api".to_string()];
    let created = upsert_fleet_project_occupied(
        &mut projects,
        "API".to_string(),
        root.path.to_string_lossy().to_string(),
        &occupied,
    );
    assert_eq!(created.slug, "api-2");
}

#[test]
fn add_group_defaults_csv_name_and_assigns_slug() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    let created = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "web".to_string()],
        None,
    )
    .expect("create group");
    assert_eq!(created.name, "api, web");
    assert_eq!(created.slug, "api-web");
    assert_eq!(created.member_slugs, vec!["api", "web"]);
    assert_eq!(groups.len(), 1);
}

#[test]
fn add_group_reuses_existing_member_set_regardless_of_order() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    let first = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "web".to_string()],
        Some("Stack"),
    )
    .expect("create group");
    let reused = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["web".to_string(), "api".to_string()],
        Some("Other"),
    )
    .expect("reuse group");
    assert_eq!(groups.len(), 1);
    assert_eq!(reused.id, first.id);
    assert_eq!(reused.slug, first.slug);
    assert_eq!(reused.name, "Stack");
}

#[test]
fn add_group_rejects_empty_unknown_duplicate_and_invalid_members() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    assert_eq!(
        upsert_fleet_group(&mut groups, &projects, vec![], None).unwrap_err(),
        "Group must include at least two projects"
    );
    assert_eq!(
        upsert_fleet_group(&mut groups, &projects, vec!["api".to_string()], None).unwrap_err(),
        "Group must include at least two projects"
    );
    assert_eq!(
        upsert_fleet_group(
            &mut groups,
            &projects,
            vec!["api".to_string(), "mobile".to_string()],
            None
        )
        .unwrap_err(),
        "Unknown project slug: mobile"
    );
    assert_eq!(
        upsert_fleet_group(
            &mut groups,
            &projects,
            vec!["api".to_string(), "api".to_string()],
            None
        )
        .unwrap_err(),
        "Duplicate member slug: api"
    );
    assert_eq!(
        upsert_fleet_group(
            &mut groups,
            &projects,
            vec!["api".to_string(), "API".to_string()],
            None
        )
        .unwrap_err(),
        "Invalid project slug: API"
    );
    assert!(groups.is_empty());
}

#[test]
fn update_group_changes_name_and_members() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    let created = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "web".to_string()],
        None,
    )
    .expect("create group");
    let updated = apply_group_update(
        &mut groups,
        &projects,
        &created.id,
        "API and web".to_string(),
        vec!["api".to_string(), "worker".to_string()],
    )
    .expect("update group");
    assert_eq!(updated.id, created.id);
    assert_eq!(updated.slug, created.slug);
    assert_eq!(updated.name, "API and web");
    assert_eq!(updated.member_slugs, vec!["api", "worker"]);
}

#[test]
fn update_group_validates_members_and_missing_id() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    let created = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "web".to_string()],
        None,
    )
    .expect("create group");
    assert_eq!(
        apply_group_update(
            &mut groups,
            &projects,
            "missing",
            "Nope".to_string(),
            vec!["api".to_string(), "web".to_string()],
        )
        .unwrap_err(),
        "Group not found"
    );
    assert_eq!(
        apply_group_update(
            &mut groups,
            &projects,
            &created.id,
            "Nope".to_string(),
            vec![],
        )
        .unwrap_err(),
        "Group must include at least two projects"
    );
    assert_eq!(
        apply_group_update(
            &mut groups,
            &projects,
            &created.id,
            "Nope".to_string(),
            vec!["api".to_string()],
        )
        .unwrap_err(),
        "Group must include at least two projects"
    );
    assert_eq!(groups[0].name, created.name);
    assert_eq!(groups[0].member_slugs, created.member_slugs);
}

#[test]
fn remove_group_drops_matching_id_and_ignores_unknown() {
    let projects = sample_projects();
    let mut groups = Vec::new();
    let first = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "web".to_string()],
        None,
    )
    .expect("first group");
    let second = upsert_fleet_group(
        &mut groups,
        &projects,
        vec!["api".to_string(), "worker".to_string()],
        None,
    )
    .expect("second group");
    remove_fleet_group(&mut groups, "missing");
    assert_eq!(groups.len(), 2);
    remove_fleet_group(&mut groups, &first.id);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].id, second.id);
}

#[test]
fn root_update_clears_worktree_link_for_non_worktree_root() {
    let root = TempRoot::new("plain");
    let root_str = root.path.to_string_lossy().to_string();
    let mut projects = vec![sample("child-1", "Child", "child", "/tmp/old-worktree")];
    projects[0].worktree = Some(WorktreeLink {
        parent_id: "parent-1".to_string(),
        branch: "vixl/feature".to_string(),
        managed: false,
    });
    let updated =
        apply_project_root_update(&mut projects, "child-1", root_str.clone()).expect("update root");
    assert_eq!(updated.root_path, root_str);
    assert_eq!(updated.worktree, None);
    assert_eq!(projects[0].worktree, None);
    assert_eq!(
        apply_project_root_update(&mut projects, "missing", root_str).unwrap_err(),
        "Project not found"
    );
}

#[cfg(windows)]
#[test]
fn normalize_root_path_drops_windows_verbatim_prefix() {
    let root = TempRoot::new("verbatim");
    let normalized = normalize_root_path(root.path.to_string_lossy().to_string());
    assert!(
        !normalized.starts_with(r"\\?\"),
        "normalized path should not use a verbatim prefix: {normalized}"
    );
}
