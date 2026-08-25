use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const VIXL_DIR: &str = ".vixl";

pub fn user_vixl_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data.join(VIXL_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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
        "skills" => list_skill_files(&base.join("skills")),
        "plans" => list_nested_markdown_files(&base.join("plans"), "PLAN.md"),
        "studio" => list_studio_files(&base.join("studio")),
        _ => Err(format!("unknown kind: {kind}")),
    }
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
