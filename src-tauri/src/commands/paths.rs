use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const VIXL_DIR: &str = ".vixl";
pub const VIXL_SQLITE_FILE: &str = "vixl.sqlite";

pub fn user_vixl_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data.join(VIXL_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

pub fn resolve_project_vixl_dir(root_path: &str) -> PathBuf {
    let mut current = PathBuf::from(root_path);
    let mut fallback = project_vixl_dir(root_path);

    for _ in 0..8 {
        let vixl_dir = current.join(VIXL_DIR);
        if vixl_dir.is_dir() {
            fallback = vixl_dir.clone();
            if vixl_dir_has_config(&vixl_dir) {
                return vixl_dir;
            }
        }
        if !current.pop() {
            break;
        }
    }

    fallback
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
    vixl_base_dir(&app, &scope, root_path).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_vixl_files(
    app: AppHandle,
    scope: String,
    kind: String,
    root_path: Option<String>,
) -> Result<Vec<ProjectFileEntry>, String> {
    let base = vixl_base_dir(&app, &scope, root_path)?;
    list_files_for_kind(&base, &kind)
}

#[tauri::command]
pub fn list_project_files(
    root_path: String,
    kind: String,
) -> Result<Vec<ProjectFileEntry>, String> {
    let base = resolve_project_vixl_dir(&root_path);
    list_files_for_kind(&base, &kind)
}

fn vixl_base_dir(
    app: &AppHandle,
    scope: &str,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    match scope {
        "personal" => user_vixl_dir(app),
        "project" => {
            let root =
                root_path.ok_or_else(|| "root_path required for project scope".to_string())?;
            Ok(resolve_project_vixl_dir(&root))
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
        "studio" => list_studio_files(&base.join("studio")),
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
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
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
        let description = read_first_description(&skill_md);
        entries.push(ProjectFileEntry {
            name,
            path: skill_md.to_string_lossy().to_string(),
            description,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn list_studio_files(studio_dir: &Path) -> Result<Vec<ProjectFileEntry>, String> {
    if !studio_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    collect_studio_index_files(studio_dir, studio_dir, &mut entries, 0)?;
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn collect_studio_index_files(
    studio_root: &Path,
    dir: &Path,
    entries: &mut Vec<ProjectFileEntry>,
    depth: usize,
) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }

        let path = entry.path();
        let index_path = path.join("index.md");
        if index_path.exists() {
            let rel = path
                .strip_prefix(studio_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            let description = read_studio_entry_description(&index_path);
            entries.push(ProjectFileEntry {
                name: rel,
                path: index_path.to_string_lossy().to_string(),
                description,
            });
            continue;
        }

        collect_studio_index_files(studio_root, &path, entries, depth + 1)?;
    }

    Ok(())
}

fn read_studio_entry_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    read_frontmatter_field(&content, "title").or_else(|| read_first_description(path))
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
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
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
    use uuid::Uuid;

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

    fn write_file(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(name), body).expect("write test file");
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
}
