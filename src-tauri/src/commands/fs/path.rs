use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub(crate) fn canonical_project_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root);
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("Invalid project root: {error}"))?;
    if !canonical.is_dir() {
        return Err("Project root is not a directory".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_workspace_path(
    project_root: &str,
    user_path: &str,
) -> Result<PathBuf, String> {
    let root = canonical_project_root(project_root)?;
    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let relative = Path::new(trimmed);
    if relative.is_absolute() {
        return Err("Path must be relative to the project root".to_string());
    }

    let mut joined = root.clone();
    for component in relative.components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("Path traversal is not allowed".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path component".to_string());
            }
        }
    }

    ensure_under_root(&root, &joined)
}

pub(crate) fn ensure_under_root(root: &Path, target: &Path) -> Result<PathBuf, String> {
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Failed to resolve path: {error}"))?;
        if !canonical.starts_with(root) {
            return Err("Path escapes project root".to_string());
        }
        return Ok(canonical);
    }

    let mut probe = target.to_path_buf();
    loop {
        if probe.exists() {
            let canonical = probe
                .canonicalize()
                .map_err(|error| format!("Failed to resolve path: {error}"))?;
            if !canonical.starts_with(root) {
                return Err("Path escapes project root".to_string());
            }
            return Ok(target.to_path_buf());
        }
        if !probe.pop() {
            break;
        }
    }

    if target.starts_with(root) {
        return Ok(target.to_path_buf());
    }

    Err("Path escapes project root".to_string())
}

pub fn is_sensitive_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();

    for segment in lower.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".env" || segment.starts_with(".env.") {
            return true;
        }
        if matches!(
            segment,
            ".ssh"
                | ".aws"
                | ".gnupg"
                | ".netrc"
                | ".npmrc"
                | ".pypirc"
                | "id_rsa"
                | "id_dsa"
                | "id_ecdsa"
                | "id_ed25519"
                | "credentials"
                | "credentials.json"
                | "secrets.json"
        ) {
            return true;
        }
        if segment.ends_with(".pem")
            || segment.ends_with(".key")
            || segment.ends_with(".p12")
            || segment.ends_with(".pfx")
            || segment.ends_with(".jks")
        {
            return true;
        }
        if segment.contains("credential")
            || segment.contains("secret")
            || segment.contains("password")
        {
            return true;
        }
    }

    // Well-known secret file paths (segment-aware checks above miss nested config names).
    if lower.ends_with("/.docker/config.json")
        || lower == ".docker/config.json"
        || lower.ends_with("/kube/config")
        || lower.ends_with("/.kube/config")
        || lower == ".kube/config"
    {
        return true;
    }

    false
}

pub(crate) fn reject_sensitive_path(user_path: &str) -> Result<(), String> {
    if is_sensitive_relative_path(user_path) {
        return Err("Sensitive path blocked".to_string());
    }
    Ok(())
}

pub(crate) fn relative_path(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| absolute.to_string_lossy().to_string())
}

pub(crate) fn entry_kind(path: &Path) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        Ok("directory".to_string())
    } else if meta.is_file() {
        Ok("file".to_string())
    } else if meta.file_type().is_symlink() {
        Ok("symlink".to_string())
    } else {
        Ok("other".to_string())
    }
}

pub(crate) fn modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}
