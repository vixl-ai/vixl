use std::path::Path;

/// Existence-only probe of the host (unsandboxed) filesystem.
///
/// A sandboxed child can report a Seatbelt read denial as ENOENT instead of
/// EPERM (for example ssh-keygen loading a denied ~/.ssh pubkey). The harness
/// compares such paths against the host: a path the child called missing that
/// exists here is a masked denial. Returns a boolean only, never file content
/// or metadata, and accepts absolute paths only.
pub fn host_path_exists(path: String) -> Result<bool, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || !Path::new(trimmed).is_absolute() {
        return Err("host_path_exists requires an absolute path".to_string());
    }
    Ok(Path::new(trimmed).exists())
}

#[tauri::command(rename = "host_path_exists")]
pub fn host_path_exists_command(path: String) -> Result<bool, String> {
    host_path_exists(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_existing_and_missing_absolute_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("key.pub");
        std::fs::write(&file, "ssh-ed25519 AAAA test\n").expect("write key");
        assert!(host_path_exists(file.to_string_lossy().into_owned()).unwrap());
        let missing = dir.path().join("absent.pub");
        assert!(!host_path_exists(missing.to_string_lossy().into_owned()).unwrap());
    }

    #[test]
    fn rejects_relative_and_blank_paths() {
        assert!(host_path_exists("relative/key.pub".to_string()).is_err());
        assert!(host_path_exists(String::new()).is_err());
        assert!(host_path_exists("   ".to_string()).is_err());
    }
}