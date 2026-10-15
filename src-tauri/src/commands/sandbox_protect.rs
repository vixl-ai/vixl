use std::fs;
use std::path::{Path, PathBuf};

use super::skip_dirs::skip_directory;

pub(crate) fn canonicalize_sandbox_path(path: &str) -> String {
    let trimmed = path.trim();
    match fs::canonicalize(trimmed) {
        Ok(canonical) => canonical.to_string_lossy().to_string(),
        Err(_) => trimmed.trim_end_matches('/').to_string(),
    }
}

/// `.git` plus a resolved worktree `gitdir`, if present.
pub(crate) fn resolve_git_protection_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let git_path = root.join(".git");
    if git_path.is_dir() {
        if let Ok(canonical) = git_path.canonicalize() {
            paths.push(canonical);
        }
        return paths;
    }

    if git_path.is_file() {
        if let Ok(canonical) = git_path.canonicalize() {
            paths.push(canonical);
        }
        if let Ok(content) = fs::read_to_string(&git_path) {
            for line in content.lines() {
                let Some(rest) = line.strip_prefix("gitdir:") else {
                    continue;
                };
                let raw = rest.trim();
                if raw.is_empty() {
                    continue;
                }
                let candidate = if Path::new(raw).is_absolute() {
                    PathBuf::from(raw)
                } else {
                    root.join(raw)
                };
                if let Ok(canonical) = candidate.canonicalize() {
                    if !paths.contains(&canonical) {
                        paths.push(canonical);
                    }
                }
            }
        }
    }

    paths
}

fn is_protected_env_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        ".env.example" | ".env.sample" | ".env.template"
    ) {
        return false;
    }
    lower == ".env" || lower.starts_with(".env.")
}

/// Discover `.env` files under `root`, skipping high-churn directories.
pub(crate) fn collect_env_protection_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    walk_env_files(root, &mut paths);
    paths
}

fn walk_env_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            if skip_directory(&name) {
                continue;
            }
            walk_env_files(&path, out);
            continue;
        }
        if is_protected_env_name(&name) {
            if let Ok(canonical) = path.canonicalize() {
                out.push(canonical);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_dir_is_protected() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir(dir.path().join(".git")).expect("mkdir .git");
        let paths = resolve_git_protection_paths(dir.path());
        assert_eq!(paths.len(), 1);
        assert_eq!(
            paths[0],
            dir.path().join(".git").canonicalize().expect("canonical")
        );
    }

    #[test]
    fn worktree_gitdir_is_protected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real_git = tempfile::tempdir().expect("gitdir");
        fs::write(
            dir.path().join(".git"),
            format!("gitdir: {}\n", real_git.path().display()),
        )
        .expect("write git file");
        let paths = resolve_git_protection_paths(dir.path());
        let expected = real_git.path().canonicalize().expect("canonical gitdir");
        assert!(paths.contains(&expected), "missing gitdir: {paths:?}");
    }

    #[test]
    fn env_files_are_discovered_and_templates_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(".env"), "A=1\n").expect("write .env");
        fs::write(dir.path().join(".env.example"), "A=\n").expect("write template");
        fs::create_dir(dir.path().join("src")).expect("mkdir src");
        fs::write(dir.path().join("src").join(".env.local"), "B=2\n").expect("write nested");
        fs::create_dir(dir.path().join("node_modules")).expect("mkdir skip");
        fs::write(dir.path().join("node_modules").join(".env"), "skip\n").expect("skip env");

        let paths = collect_env_protection_paths(dir.path());
        let names: Vec<_> = paths
            .iter()
            .filter_map(|path| path.file_name()?.to_str())
            .collect();
        assert!(names.contains(&".env"));
        assert!(names.contains(&".env.local"));
        assert!(!names.contains(&".env.example"));
        assert_eq!(paths.len(), 2);
    }
}
