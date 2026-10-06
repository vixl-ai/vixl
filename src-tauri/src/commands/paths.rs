use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

const VIXL_DIR: &str = ".vixl";
pub const VIXL_SQLITE_FILE: &str = "vixl.sqlite";

pub fn user_vixl_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let dir = user_vixl_dir_path()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn user_vixl_dir_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "home directory unavailable".to_string())?;
    Ok(home.join(VIXL_DIR))
}

pub fn vixl_sqlite_path(user_vixl_dir: &Path) -> PathBuf {
    user_vixl_dir.join(VIXL_SQLITE_FILE)
}

pub fn user_vixl_sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vixl_sqlite_path(&user_vixl_dir(app)?))
}

pub fn project_vixl_dir(root_path: &str) -> PathBuf {
    Path::new(root_path).join(VIXL_DIR)
}

fn vixl_dir_has_config(vixl_dir: &Path) -> bool {
    vixl_dir.join("mcp.json").exists() || vixl_dir.join("settings.json").exists()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub(crate) const HOME_PROJECT_SCOPE_ERROR: &str =
    "Refusing project-scope changes for the home directory";

/// True when `path` is the same directory as `home`.
///
/// Exact path equality matches even when canonicalize fails (missing
/// directory). Otherwise `path` is canonicalized and compared to
/// `home_canonical`, which the caller computes once.
fn path_is_home(path: &Path, home: &Path, home_canonical: Option<&Path>) -> bool {
    if path == home {
        return true;
    }
    let Some(home_canonical) = home_canonical else {
        return false;
    };
    match dunce::canonicalize(path) {
        Ok(path_canonical) => path_canonical == home_canonical,
        Err(_) => false,
    }
}

/// True when `root_path` is the user home directory (`HOME` or `USERPROFILE`).
///
/// Fleet project roots are stored after `dunce::canonicalize`. The home path is
/// not. Canonicalize both sides the same way so a symlink, a trailing `.` or
/// `..`, or a Windows casing difference still counts as home. Returns false
/// when home is unavailable.
fn root_is_home(root_path: &str) -> bool {
    let root = root_path.trim();
    if root.is_empty() {
        return false;
    }

    let Some(home) = home_dir() else {
        return false;
    };
    if home.as_os_str().is_empty() {
        return false;
    }

    let home_canonical = dunce::canonicalize(&home).ok();
    path_is_home(Path::new(root), &home, home_canonical.as_deref())
}

#[tauri::command]
pub fn is_home_workspace_root(root_path: String) -> bool {
    root_is_home(&root_path)
}

pub(crate) fn project_scope_targets_home(scope: &str, root_path: Option<&str>) -> bool {
    scope == "project" && root_path.is_some_and(root_is_home)
}

pub(crate) fn refuse_home_project_write(
    scope: &str,
    root_path: Option<&str>,
) -> Result<(), String> {
    if project_scope_targets_home(scope, root_path) {
        return Err(HOME_PROJECT_SCOPE_ERROR.to_string());
    }
    Ok(())
}

pub fn resolve_project_vixl_dir(root_path: &str) -> PathBuf {
    let mut current = PathBuf::from(root_path);

    // $HOME/.vixl is the personal root. When the opened root is $HOME, that
    // path is also <project>/.vixl. Do not walk above $HOME. Fleet roots are
    // stored canonical, so this uses the same comparison as `root_is_home`.
    if root_is_home(root_path) {
        return project_vixl_dir(root_path);
    }

    let local = current.join(VIXL_DIR);
    if local.is_dir() {
        return local;
    }

    // Canonicalize home once. Each ancestor is compared with `path_is_home`,
    // so a symlink target or a `.` / `..` spelling still stops at home.
    let home = home_dir();
    let home_canonical = home.as_ref().and_then(|home_path| {
        if home_path.as_os_str().is_empty() {
            None
        } else {
            dunce::canonicalize(home_path).ok()
        }
    });

    for _ in 0..8 {
        if !current.pop() {
            break;
        }
        if home.as_ref().is_some_and(|home_path| {
            path_is_home(current.as_path(), home_path, home_canonical.as_deref())
        }) {
            break;
        }
        let vixl_dir = current.join(VIXL_DIR);
        if vixl_dir.is_dir() {
            return vixl_dir;
        }
    }

    project_vixl_dir(root_path)
}

fn find_workspace_root(mut dir: PathBuf) -> PathBuf {
    for _ in 0..8 {
        if dir.join("package.json").exists()
            && (dir.join("src-tauri").exists() || dir.join(VIXL_DIR).exists())
        {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }

    dir
}

#[tauri::command]
pub fn get_user_vixl_dir(app: AppHandle) -> Result<String, String> {
    user_vixl_dir(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn has_project_vixl(root_path: String) -> Result<bool, String> {
    if root_is_home(&root_path) {
        return Ok(false);
    }
    let vixl_dir = resolve_project_vixl_dir(&root_path);
    Ok(vixl_dir.is_dir() && vixl_dir_has_config(&vixl_dir))
}

#[tauri::command]
pub fn get_default_workspace_root() -> String {
    match std::env::current_dir() {
        Ok(dir) => find_workspace_root(dir).to_string_lossy().to_string(),
        Err(_) => "/".to_string(),
    }
}

#[derive(serde::Serialize)]
pub struct ProjectFileEntry {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

#[tauri::command]
pub fn get_vixl_dir(
    app: AppHandle,
    scope: String,
    root_path: Option<String>,
) -> Result<String, String> {
    vixl_base_dir(&scope, root_path.as_deref(), || user_vixl_dir(&app))
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_vixl_files(
    app: AppHandle,
    scope: String,
    kind: String,
    root_path: Option<String>,
) -> Result<Vec<ProjectFileEntry>, String> {
    list_vixl_files_at(&scope, &kind, root_path.as_deref(), || user_vixl_dir(&app))
}

fn list_vixl_files_at(
    scope: &str,
    kind: &str,
    root_path: Option<&str>,
    personal_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<Vec<ProjectFileEntry>, String> {
    if project_scope_targets_home(scope, root_path) {
        return Ok(vec![]);
    }
    let base = vixl_base_dir(scope, root_path, personal_dir)?;
    list_files_for_kind(&base, kind)
}

#[tauri::command]
pub fn list_project_files(
    root_path: String,
    kind: String,
) -> Result<Vec<ProjectFileEntry>, String> {
    if root_is_home(&root_path) {
        return Ok(vec![]);
    }
    let base = resolve_project_vixl_dir(&root_path);
    list_files_for_kind(&base, &kind)
}

fn vixl_base_dir(
    scope: &str,
    root_path: Option<&str>,
    personal_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    match scope {
        "personal" => personal_dir(),
        "project" => {
            let root =
                root_path.ok_or_else(|| "root_path required for project scope".to_string())?;
            Ok(resolve_project_vixl_dir(root))
        }
        other => Err(format!("unknown scope: {other}")),
    }
}

fn list_files_for_kind(base: &Path, kind: &str) -> Result<Vec<ProjectFileEntry>, String> {
    match kind {
        "agents" | "rules" => list_flat_markdown_files(&base.join(kind)),
        "agents-md" => list_agents_md_file(base),
        "skills" => list_skill_files(&base.join("skills")),
        "plans" => list_nested_markdown_files(&base.join("plans"), "PLAN.md"),
        _ => Err(format!("unknown kind: {kind}")),
    }
}

/// Singleton `.vixl/AGENTS.md` (preferred) or `.vixl/agents.md`. No recursion.
pub(crate) fn list_agents_md_file(base: &Path) -> Result<Vec<ProjectFileEntry>, String> {
    if !base.is_dir() {
        return Ok(vec![]);
    }

    let mut found_upper: Option<PathBuf> = None;
    let mut found_lower: Option<PathBuf> = None;

    for entry in fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        let name = entry.file_name();
        if name == "AGENTS.md" {
            found_upper = Some(entry.path());
        } else if name == "agents.md" {
            found_lower = Some(entry.path());
        }
    }

    let Some(path) = found_upper.or(found_lower) else {
        return Ok(vec![]);
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "AGENTS.md".to_string());
    let description = read_first_description(&path);
    Ok(vec![ProjectFileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        description,
    }])
}

fn list_skill_files(dir: &Path) -> Result<Vec<ProjectFileEntry>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let skill_md = entry.path().join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let description = fs::read_to_string(&skill_md)
            .ok()
            .and_then(|content| read_frontmatter_field(&content, "description"));
        entries.push(ProjectFileEntry {
            name,
            path: skill_md.to_string_lossy().to_string(),
            description,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn read_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            in_frontmatter = !in_frontmatter;
            if !in_frontmatter {
                break;
            }
            continue;
        }
        if !in_frontmatter {
            continue;
        }
        let prefix = format!("{field}:");
        if let Some(value) = trimmed.strip_prefix(&prefix) {
            let mut parsed = value.trim().to_string();
            if (parsed.starts_with('"') && parsed.ends_with('"'))
                || (parsed.starts_with('\'') && parsed.ends_with('\''))
            {
                parsed = parsed[1..parsed.len() - 1].to_string();
            }
            if !parsed.is_empty() {
                return Some(parsed);
            }
        }
    }
    None
}

fn list_nested_markdown_files(
    dir: &Path,
    file_name: &str,
) -> Result<Vec<ProjectFileEntry>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let file_path = entry.path().join(file_name);
        if !file_path.exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let description = read_first_description(&file_path);
        entries.push(ProjectFileEntry {
            name,
            path: file_path.to_string_lossy().to_string(),
            description,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn list_flat_markdown_files(dir: &Path) -> Result<Vec<ProjectFileEntry>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let is_markdown = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext == "md" || ext == "mdc");
        if !is_markdown {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let description = read_first_description(&path);
        entries.push(ProjectFileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            description,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn read_first_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    if let Some(description) = read_frontmatter_field(&content, "description") {
        return Some(description);
    }
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("---") {
            continue;
        }
        return Some(trimmed.chars().take(120).collect());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{OsStr, OsString};
    use std::path::PathBuf;
    use std::sync::Mutex;
    use uuid::Uuid;

    use crate::commands::config::{
        read_scoped_json, scoped_config_exists, set_scoped_mcp_server_enabled, write_scoped_json,
    };

    static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempVixlDir {
        path: PathBuf,
    }

    impl TempVixlDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("vixl-agents-md-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("temp vixl dir");
            Self { path }
        }
    }

    impl Drop for TempVixlDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct TempResolveTree {
        path: PathBuf,
    }

    impl TempResolveTree {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("vixl-resolve-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("temp resolve tree");
            Self { path }
        }
    }

    impl Drop for TempResolveTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct HomeEnvGuard {
        previous_home: Option<OsString>,
        previous_userprofile: Option<OsString>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl HomeEnvGuard {
        fn set_home(home: &Path) -> Self {
            Self::swap(Some(home.as_os_str()))
        }

        fn clear() -> Self {
            Self::swap(None)
        }

        fn swap(next: Option<&OsStr>) -> Self {
            let lock = HOME_ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous_home = std::env::var_os("HOME");
            let previous_userprofile = std::env::var_os("USERPROFILE");
            match next {
                Some(home) => {
                    std::env::set_var("HOME", home);
                    std::env::set_var("USERPROFILE", home);
                }
                None => {
                    std::env::remove_var("HOME");
                    std::env::remove_var("USERPROFILE");
                }
            }
            Self {
                previous_home,
                previous_userprofile,
                _lock: lock,
            }
        }
    }

    impl Drop for HomeEnvGuard {
        fn drop(&mut self) {
            restore_env("HOME", self.previous_home.as_ref());
            restore_env("USERPROFILE", self.previous_userprofile.as_ref());
        }
    }

    fn restore_env(key: &str, previous: Option<&OsString>) {
        match previous {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    fn write_file(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(name), body).expect("write test file");
    }

    fn mkdir(path: &Path) {
        fs::create_dir_all(path).expect("create test dir");
    }

    fn path_str(path: &Path) -> &str {
        path.to_str().expect("utf-8 test path")
    }

    fn unused_personal_dir() -> Result<PathBuf, String> {
        panic!("project home guard resolved the personal directory");
    }

    #[test]
    fn missing_returns_empty() {
        let dir = TempVixlDir::new();
        let entries = list_agents_md_file(&dir.path).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn lists_agents_md_uppercase() {
        let dir = TempVixlDir::new();
        write_file(&dir.path, "AGENTS.md", "Use tabs.");
        let entries = list_agents_md_file(&dir.path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "AGENTS.md");
        assert!(entries[0].path.ends_with("AGENTS.md"));
    }

    #[test]
    fn falls_back_to_lowercase_agents_md() {
        let dir = TempVixlDir::new();
        write_file(&dir.path, "agents.md", "Use spaces.");
        let entries = list_agents_md_file(&dir.path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "agents.md");
    }

    #[test]
    fn prefers_uppercase_when_both_exist_as_distinct_files() {
        let dir = TempVixlDir::new();
        write_file(&dir.path, "AGENTS.md", "upper");
        write_file(&dir.path, "agents.md", "lower");

        let distinct_names: Vec<String> = fs::read_dir(&dir.path)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name == "AGENTS.md" || name == "agents.md")
            .collect();

        let entries = list_agents_md_file(&dir.path).unwrap();
        assert_eq!(entries.len(), 1);
        if distinct_names.len() >= 2 {
            assert_eq!(entries[0].name, "AGENTS.md");
        } else {
            assert!(
                entries[0].name == "AGENTS.md" || entries[0].name == "agents.md",
                "case-insensitive FS should still return the singleton"
            );
        }
    }

    #[test]
    fn does_not_return_file_inside_agents_dir() {
        let dir = TempVixlDir::new();
        let agents_dir = dir.path.join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        write_file(&agents_dir, "AGENTS.md", "subagent file");
        write_file(&agents_dir, "reviewer.md", "a subagent");
        let entries = list_agents_md_file(&dir.path).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn does_not_return_nested_subdir_agents_md() {
        let dir = TempVixlDir::new();
        let nested = dir.path.join("subdir");
        fs::create_dir_all(&nested).unwrap();
        write_file(&nested, "AGENTS.md", "nested");
        let entries = list_agents_md_file(&dir.path).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn resolve_project_vixl_dir_skills_only_local_wins_over_ancestor_settings() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let ancestor = home.join("workspace");
        let project = ancestor.join("opened");
        let local_vixl = project.join(".vixl");
        let ancestor_vixl = ancestor.join(".vixl");
        let home_vixl = home.join(".vixl");

        mkdir(&local_vixl.join("skills"));
        mkdir(&ancestor_vixl);
        write_file(&ancestor_vixl, "settings.json", "{}");
        mkdir(&home_vixl);
        write_file(&home_vixl, "settings.json", "{}");

        let _home_env = HomeEnvGuard::set_home(&home);
        let resolved = resolve_project_vixl_dir(path_str(&project));
        assert_eq!(resolved, local_vixl);
        assert!(!local_vixl.join("settings.json").exists());
        assert!(!local_vixl.join("mcp.json").exists());
    }

    #[test]
    fn resolve_project_vixl_dir_nested_resolves_to_ancestor_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let _home_env = HomeEnvGuard::set_home(&home);

        let skills_project = home.join("skills-project");
        let skills_nested = skills_project.join("src").join("nested");
        let skills_vixl = skills_project.join(".vixl");
        mkdir(&skills_vixl.join("skills"));
        mkdir(&skills_nested);
        assert_eq!(
            resolve_project_vixl_dir(path_str(&skills_nested)),
            skills_vixl
        );

        let config_project = home.join("config-project");
        let config_nested = config_project.join("src").join("nested");
        let config_vixl = config_project.join(".vixl");
        mkdir(&config_vixl);
        write_file(&config_vixl, "mcp.json", "{}");
        mkdir(&config_nested);
        assert_eq!(
            resolve_project_vixl_dir(path_str(&config_nested)),
            config_vixl
        );
    }

    #[test]
    fn resolve_project_vixl_dir_missing_returns_root_join_fallback() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let project = home.join("opened");
        mkdir(&project);

        let _home_env = HomeEnvGuard::set_home(&home);
        let resolved = resolve_project_vixl_dir(path_str(&project));
        assert_eq!(resolved, project.join(".vixl"));
        assert!(!resolved.exists());
    }

    #[test]
    fn user_vixl_dir_path_is_home_dot_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        mkdir(&home);

        let _home_env = HomeEnvGuard::set_home(&home);
        let resolved = user_vixl_dir_path().expect("personal vixl path");
        assert_eq!(resolved, home.join(".vixl"));
        assert!(!resolved.exists());
    }

    #[test]
    fn user_vixl_dir_path_errors_without_home() {
        let _home_env = HomeEnvGuard::clear();
        let error = user_vixl_dir_path().expect_err("missing home");
        assert_eq!(error, "home directory unavailable");
    }

    #[test]
    fn resolve_project_vixl_dir_home_root_is_home_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let ancestor_vixl = tree.path.join(".vixl");
        mkdir(&home);
        mkdir(&ancestor_vixl);
        write_file(&ancestor_vixl, "settings.json", "{}");

        let _home_env = HomeEnvGuard::set_home(&home);
        let resolved = resolve_project_vixl_dir(path_str(&home));
        assert_eq!(resolved, home.join(".vixl"));
        assert_ne!(resolved, ancestor_vixl);
        assert!(!resolved.exists());
    }

    #[test]
    fn resolve_project_vixl_dir_home_root_matches_canonical_spelling() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let ancestor_vixl = tree.path.join(".vixl");
        mkdir(&home);
        mkdir(&ancestor_vixl);
        write_file(&ancestor_vixl, "settings.json", "{}");

        let canonical = dunce::canonicalize(&home).expect("canonical home");
        let dotted = home.join(".");

        {
            let _home_env = HomeEnvGuard::set_home(&dotted);
            let resolved = resolve_project_vixl_dir(path_str(&canonical));
            assert_eq!(resolved, canonical.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }

        {
            let _home_env = HomeEnvGuard::set_home(&canonical);
            let resolved = resolve_project_vixl_dir(path_str(&dotted));
            assert_eq!(resolved, dotted.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!home.join(".vixl").exists());
        }
    }

    #[test]
    fn resolve_project_vixl_dir_nested_stops_at_home_when_spellings_differ() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let nested = home.join("project").join("src");
        let home_vixl = home.join(".vixl");
        let ancestor_vixl = tree.path.join(".vixl");
        mkdir(&nested);
        mkdir(&home_vixl);
        write_file(&home_vixl, "settings.json", "{}");
        mkdir(&ancestor_vixl);
        write_file(&ancestor_vixl, "settings.json", "{}");

        let canonical_home = dunce::canonicalize(&home).expect("canonical home");
        let canonical_nested = dunce::canonicalize(&nested).expect("canonical nested");
        let dotted_home = home.join(".");

        {
            let _home_env = HomeEnvGuard::set_home(&dotted_home);
            let resolved = resolve_project_vixl_dir(path_str(&canonical_nested));
            assert_eq!(resolved, canonical_nested.join(".vixl"));
            assert_ne!(resolved, home_vixl);
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }

        {
            let _home_env = HomeEnvGuard::set_home(&canonical_home);
            let dotted_nested = dotted_home.join("project").join("src");
            let resolved = resolve_project_vixl_dir(path_str(&dotted_nested));
            assert_eq!(resolved, dotted_nested.join(".vixl"));
            assert_ne!(resolved, home_vixl);
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn resolve_project_vixl_dir_stops_at_symlinked_home() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let nested = home.join("project").join("src");
        let ancestor_vixl = tree.path.join(".vixl");
        mkdir(&nested);
        mkdir(&ancestor_vixl);
        write_file(&ancestor_vixl, "settings.json", "{}");
        let link = tree.path.join("home-link");
        std::os::unix::fs::symlink(&home, &link).expect("symlink home");

        let canonical_home = dunce::canonicalize(&home).expect("canonical home");
        let canonical_nested = dunce::canonicalize(&nested).expect("canonical nested");

        {
            let _home_env = HomeEnvGuard::set_home(&link);
            let resolved = resolve_project_vixl_dir(path_str(&canonical_home));
            assert_eq!(resolved, canonical_home.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }

        {
            let _home_env = HomeEnvGuard::set_home(&canonical_home);
            let resolved = resolve_project_vixl_dir(path_str(&link));
            assert_eq!(resolved, link.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }

        {
            let _home_env = HomeEnvGuard::set_home(&link);
            let resolved = resolve_project_vixl_dir(path_str(&canonical_nested));
            assert_eq!(resolved, canonical_nested.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }

        {
            let _home_env = HomeEnvGuard::set_home(&home);
            let link_nested = link.join("project").join("src");
            let resolved = resolve_project_vixl_dir(path_str(&link_nested));
            assert_eq!(resolved, link_nested.join(".vixl"));
            assert_ne!(resolved, ancestor_vixl);
            assert!(!resolved.exists());
        }
    }

    #[test]
    fn resolve_project_vixl_dir_does_not_select_home_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let project = home.join("opened");
        let nested = project.join("src").join("nested");
        let home_vixl = home.join(".vixl");

        mkdir(&nested);
        mkdir(&home_vixl);
        write_file(&home_vixl, "settings.json", "{}");

        let _home_env = HomeEnvGuard::set_home(&home);
        let from_project = resolve_project_vixl_dir(path_str(&project));
        let from_nested = resolve_project_vixl_dir(path_str(&nested));
        assert_eq!(from_project, project.join(".vixl"));
        assert_eq!(from_nested, nested.join(".vixl"));
        assert_ne!(from_project, home_vixl);
        assert_ne!(from_nested, home_vixl);
    }

    #[cfg(unix)]
    #[test]
    fn lists_symlinked_agents_md() {
        let dir = TempVixlDir::new();
        write_file(&dir.path, "real-agents.md", "Linked agents body.");
        std::os::unix::fs::symlink(dir.path.join("real-agents.md"), dir.path.join("agents.md"))
            .expect("symlink agents.md");

        let entries = list_agents_md_file(&dir.path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "agents.md");
        assert!(entries[0].path.ends_with("agents.md"));
        assert_eq!(
            entries[0].description.as_deref(),
            Some("Linked agents body.")
        );
    }

    #[test]
    fn list_flat_markdown_files_includes_mdc() {
        let dir = TempVixlDir::new();
        write_file(&dir.path, "plain.md", "A markdown rule.");
        write_file(&dir.path, "cursor.mdc", "An mdc rule.");
        write_file(&dir.path, "ignored.txt", "Not a rule.");

        let entries = list_flat_markdown_files(&dir.path).unwrap();
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["cursor.mdc", "plain.md"]);
    }

    #[test]
    fn read_first_description_prefers_frontmatter_then_body() {
        let dir = TempVixlDir::new();
        write_file(
            &dir.path,
            "with-frontmatter.mdc",
            "---\ndescription: \"Ship the app\"\nglobs: \"**/*.ts\"\n---\n\n# Heading\nBody line.\n",
        );
        write_file(
            &dir.path,
            "without-frontmatter.md",
            "# Heading\n\nFirst text line.\n",
        );

        let entries = list_flat_markdown_files(&dir.path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "with-frontmatter.mdc");
        assert_eq!(entries[0].description.as_deref(), Some("Ship the app"));
        assert_eq!(entries[1].name, "without-frontmatter.md");
        assert_eq!(entries[1].description.as_deref(), Some("First text line."));
    }

    #[test]
    fn list_skill_files_uses_frontmatter_description_not_name_line() {
        let dir = TempVixlDir::new();
        let skill_dir = dir.path.join("deploy");
        fs::create_dir_all(&skill_dir).unwrap();
        write_file(
            &skill_dir,
            "SKILL.md",
            "---\nname: deploy\ndescription: Ship the app\n---\n\nBody.\n",
        );

        let entries = list_skill_files(&dir.path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "deploy");
        assert_eq!(entries[0].description.as_deref(), Some("Ship the app"));
    }

    #[test]
    fn is_home_workspace_root_matches_canonical_home() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        mkdir(&home);
        let canonical = dunce::canonicalize(&home).expect("canonical home");

        {
            let _home_env = HomeEnvGuard::set_home(&home);
            assert!(is_home_workspace_root(path_str(&home).to_string()));
            assert!(is_home_workspace_root(
                canonical.to_string_lossy().to_string()
            ));
            assert!(is_home_workspace_root(format!("{}/", path_str(&home))));
            assert!(is_home_workspace_root(format!("{}/.", path_str(&home))));
            let via_parent = home.join("..").join(home.file_name().expect("home name"));
            assert!(is_home_workspace_root(
                via_parent.to_string_lossy().to_string()
            ));
        }

        {
            let _home_env = HomeEnvGuard::set_home(&canonical);
            assert!(is_home_workspace_root(path_str(&home).to_string()));
        }
    }

    #[test]
    fn is_home_workspace_root_rejects_other_and_blank_paths() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let child = home.join("project");
        mkdir(&child);

        let _home_env = HomeEnvGuard::set_home(&home);
        assert!(!is_home_workspace_root(path_str(&child).to_string()));
        assert!(!is_home_workspace_root(path_str(&tree.path).to_string()));
        assert!(!is_home_workspace_root(String::new()));
        assert!(!is_home_workspace_root("   ".to_string()));
    }

    #[test]
    fn is_home_workspace_root_false_without_home() {
        let _home_env = HomeEnvGuard::clear();
        assert!(!is_home_workspace_root("/tmp/proj".to_string()));
    }

    #[test]
    fn is_home_workspace_root_exact_path_matches_when_canonicalize_fails() {
        let tree = TempResolveTree::new();
        let missing = tree.path.join("missing-home");
        let _home_env = HomeEnvGuard::set_home(&missing);

        assert!(is_home_workspace_root(path_str(&missing).to_string()));
        assert!(!is_home_workspace_root(path_str(&tree.path).to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn is_home_workspace_root_matches_symlink_to_home() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        mkdir(&home);
        let link = tree.path.join("home-link");
        std::os::unix::fs::symlink(&home, &link).expect("symlink home");

        {
            let _home_env = HomeEnvGuard::set_home(&link);
            assert!(is_home_workspace_root(path_str(&home).to_string()));
            assert!(is_home_workspace_root(path_str(&link).to_string()));
            let link_canonical = dunce::canonicalize(&link).expect("canonical link");
            assert!(is_home_workspace_root(
                link_canonical.to_string_lossy().to_string()
            ));
        }

        {
            let _home_env = HomeEnvGuard::set_home(&home);
            assert!(is_home_workspace_root(path_str(&link).to_string()));
        }
    }

    #[test]
    fn is_home_workspace_root_matches_case_when_filesystem_ignores_it() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("CaseHome");
        mkdir(&home);
        let flipped = tree.path.join("casehome");
        if !flipped.exists() {
            return;
        }

        let _home_env = HomeEnvGuard::set_home(&home);
        assert!(is_home_workspace_root(path_str(&flipped).to_string()));
    }

    #[test]
    fn home_project_scope_reads_are_empty_and_writes_are_refused() {
        assert_eq!(
            HOME_PROJECT_SCOPE_ERROR,
            "Refusing project-scope changes for the home directory"
        );

        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let vixl = home.join(".vixl");
        let agents = vixl.join("agents");
        mkdir(&agents);
        let settings = r#"{"secret":"personal"}"#;
        let mcp = r#"{"servers":{"brave":{"command":"npx","enabled":true}}}"#;
        write_file(&vixl, "settings.json", settings);
        write_file(&vixl, "mcp.json", mcp);
        write_file(&agents, "solo.md", "Personal agent.");

        let _home_env = HomeEnvGuard::set_home(&home);
        let home_str = path_str(&home);

        assert!(!has_project_vixl(home_str.to_string()).unwrap());
        assert!(
            list_project_files(home_str.to_string(), "agents".to_string())
                .unwrap()
                .is_empty()
        );
        assert!(
            list_vixl_files_at("project", "agents", Some(home_str), unused_personal_dir)
                .unwrap()
                .is_empty()
        );

        let project_settings = read_scoped_json(
            "project",
            Some(home_str),
            "settings.json",
            unused_personal_dir,
        )
        .unwrap();
        let project_mcp =
            read_scoped_json("project", Some(home_str), "mcp.json", unused_personal_dir).unwrap();
        assert_eq!(project_settings, serde_json::json!({}));
        assert_eq!(project_mcp, serde_json::json!({}));
        assert!(!scoped_config_exists("project", Some(home_str), unused_personal_dir).unwrap());

        let settings_err = write_scoped_json(
            "project",
            Some(home_str),
            "settings.json",
            serde_json::json!({"secret": "hijack"}),
            unused_personal_dir,
        )
        .unwrap_err();
        let mcp_err = write_scoped_json(
            "project",
            Some(home_str),
            "mcp.json",
            serde_json::json!({"servers": {}}),
            unused_personal_dir,
        )
        .unwrap_err();
        let enabled_err = set_scoped_mcp_server_enabled(
            "project",
            Some(home_str),
            "brave",
            false,
            unused_personal_dir,
        )
        .unwrap_err();
        assert_eq!(settings_err, HOME_PROJECT_SCOPE_ERROR);
        assert_eq!(mcp_err, HOME_PROJECT_SCOPE_ERROR);
        assert_eq!(enabled_err, HOME_PROJECT_SCOPE_ERROR);
        assert_eq!(
            fs::read_to_string(vixl.join("settings.json")).unwrap(),
            settings
        );
        assert_eq!(fs::read_to_string(vixl.join("mcp.json")).unwrap(), mcp);

        let personal_settings =
            read_scoped_json("personal", Some(home_str), "settings.json", || {
                Ok(vixl.clone())
            })
            .unwrap();
        assert_eq!(personal_settings["secret"], "personal");
        assert!(scoped_config_exists("personal", Some(home_str), || Ok(vixl.clone())).unwrap());
        let personal_files =
            list_vixl_files_at("personal", "agents", Some(home_str), || Ok(vixl.clone())).unwrap();
        assert_eq!(personal_files.len(), 1);
        assert_eq!(personal_files[0].name, "solo.md");

        write_scoped_json(
            "personal",
            Some(home_str),
            "settings.json",
            serde_json::json!({"secret": "updated"}),
            || Ok(vixl.clone()),
        )
        .unwrap();
        let enabled =
            set_scoped_mcp_server_enabled("personal", Some(home_str), "brave", false, || {
                Ok(vixl.clone())
            })
            .unwrap();
        assert!(enabled);
        let saved_settings: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(vixl.join("settings.json")).unwrap()).unwrap();
        let saved_mcp: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(vixl.join("mcp.json")).unwrap()).unwrap();
        assert_eq!(saved_settings["secret"], "updated");
        assert_eq!(saved_mcp["servers"]["brave"]["enabled"], false);
    }

    #[test]
    fn home_project_scope_does_not_create_personal_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        mkdir(&home);

        let _home_env = HomeEnvGuard::set_home(&home);
        let home_str = path_str(&home);
        let dotted = format!("{home_str}/.");

        let missing_root = write_scoped_json(
            "project",
            None,
            "settings.json",
            serde_json::json!({}),
            unused_personal_dir,
        )
        .unwrap_err();
        assert_eq!(missing_root, "root_path required for project scope");

        let read = read_scoped_json(
            "project",
            Some(&dotted),
            "settings.json",
            unused_personal_dir,
        )
        .unwrap();
        assert_eq!(read, serde_json::json!({}));
        let err = write_scoped_json(
            "project",
            Some(&dotted),
            "settings.json",
            serde_json::json!({"x": 1}),
            unused_personal_dir,
        )
        .unwrap_err();
        assert_eq!(err, HOME_PROJECT_SCOPE_ERROR);
        assert!(!has_project_vixl(dotted).unwrap());
        assert!(!home.join(".vixl").exists());
    }

    #[test]
    fn real_project_scope_still_uses_project_vixl() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let vixl = home.join(".vixl");
        let project = home.join("work");
        let project_vixl = project.join(".vixl");
        mkdir(&vixl);
        mkdir(&project_vixl.join("agents"));
        write_file(&vixl, "settings.json", r#"{"secret":"personal"}"#);
        write_file(&project_vixl, "settings.json", r#"{"name":"work"}"#);
        write_file(&project_vixl.join("agents"), "worker.md", "Project agent.");

        let _home_env = HomeEnvGuard::set_home(&home);
        let project_str = path_str(&project);

        assert!(has_project_vixl(project_str.to_string()).unwrap());
        let settings = read_scoped_json(
            "project",
            Some(project_str),
            "settings.json",
            unused_personal_dir,
        )
        .unwrap();
        assert_eq!(settings["name"], "work");
        assert!(settings.get("secret").is_none());

        let listed =
            list_vixl_files_at("project", "agents", Some(project_str), unused_personal_dir)
                .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "worker.md");
        let project_files =
            list_project_files(project_str.to_string(), "agents".to_string()).unwrap();
        assert_eq!(project_files.len(), 1);

        write_scoped_json(
            "project",
            Some(project_str),
            "settings.json",
            serde_json::json!({"name": "updated"}),
            unused_personal_dir,
        )
        .unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(project_vixl.join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(saved["name"], "updated");
        assert_eq!(
            fs::read_to_string(vixl.join("settings.json")).unwrap(),
            r#"{"secret":"personal"}"#
        );
        assert!(scoped_config_exists("project", Some(project_str), unused_personal_dir).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn home_symlink_project_scope_is_refused() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        let vixl = home.join(".vixl");
        mkdir(&vixl);
        let settings = r#"{"secret":"personal"}"#;
        write_file(&vixl, "settings.json", settings);
        let link = tree.path.join("home-link");
        std::os::unix::fs::symlink(&home, &link).expect("symlink home");

        let _home_env = HomeEnvGuard::set_home(&home);
        assert!(!has_project_vixl(path_str(&link).to_string()).unwrap());
        let err = write_scoped_json(
            "project",
            Some(path_str(&link)),
            "settings.json",
            serde_json::json!({"secret": "hijack"}),
            unused_personal_dir,
        )
        .unwrap_err();
        assert_eq!(err, HOME_PROJECT_SCOPE_ERROR);
        assert_eq!(
            fs::read_to_string(vixl.join("settings.json")).unwrap(),
            settings
        );
        assert!(list_vixl_files_at(
            "project",
            "agents",
            Some(path_str(&link)),
            unused_personal_dir
        )
        .unwrap()
        .is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn is_home_workspace_root_matches_different_casing() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("Home");
        mkdir(&home);
        let flipped = flip_last_ascii_letter(path_str(&home));
        assert_ne!(flipped, path_str(&home));

        let _home_env = HomeEnvGuard::set_home(&home);
        assert!(is_home_workspace_root(flipped));
    }

    #[cfg(windows)]
    #[test]
    fn is_home_workspace_root_matches_slash_direction() {
        let tree = TempResolveTree::new();
        let home = tree.path.join("home");
        mkdir(&home);
        let forward = path_str(&home).replace('\\', "/");

        let _home_env = HomeEnvGuard::set_home(&home);
        assert!(is_home_workspace_root(forward));
    }

    #[cfg(windows)]
    fn flip_last_ascii_letter(path: &str) -> String {
        let mut chars: Vec<char> = path.chars().collect();
        for ch in chars.iter_mut().rev() {
            if ch.is_ascii_alphabetic() {
                if ch.is_ascii_lowercase() {
                    *ch = ch.to_ascii_uppercase();
                } else {
                    *ch = ch.to_ascii_lowercase();
                }
                break;
            }
        }
        chars.into_iter().collect()
    }
}
