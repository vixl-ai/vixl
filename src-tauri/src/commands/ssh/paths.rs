use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const SSH_BIN: &str = "/usr/bin/ssh";
pub const MAX_UNIX_SOCKET_BYTES: usize = 103;
pub const CONTROL_PATH_TEMP_MARGIN: usize = 20;
pub const CONTROL_ID_HEX_LEN: usize = 16;

#[derive(Clone, Debug)]
pub struct SshPaths {
    pub vixl_ssh_dir: PathBuf,
    pub user_ssh_dir: PathBuf,
}

impl SshPaths {
    pub fn production() -> Result<Self, String> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "home directory unavailable".to_string())?;
        Ok(Self {
            vixl_ssh_dir: home.join(".vixl").join("ssh"),
            user_ssh_dir: home.join(".ssh"),
        })
    }

    pub fn from_roots(vixl_ssh_dir: PathBuf, user_ssh_dir: PathBuf) -> Self {
        Self {
            vixl_ssh_dir,
            user_ssh_dir,
        }
    }

    pub fn control_dir(&self) -> PathBuf {
        self.vixl_ssh_dir.join("cm")
    }

    pub fn known_hosts(&self) -> PathBuf {
        self.vixl_ssh_dir.join("known_hosts")
    }

    pub fn user_known_hosts(&self) -> PathBuf {
        self.user_ssh_dir.join("known_hosts")
    }

    pub fn user_config(&self) -> PathBuf {
        self.user_ssh_dir.join("config")
    }

    pub fn askpass_helper(&self) -> PathBuf {
        self.vixl_ssh_dir.join("askpass")
    }

    pub fn lock_path(&self, control_id: &str) -> PathBuf {
        self.control_dir().join(format!("{control_id}.lock"))
    }

    pub fn control_path(&self, control_id: &str) -> PathBuf {
        self.control_dir().join(control_id)
    }

    pub fn askpass_socket(&self, control_id: &str) -> PathBuf {
        self.vixl_ssh_dir.join(format!("a{control_id}.sock"))
    }
}

pub fn session_control_id(user: &str, hostname: &str, port: u16) -> String {
    let mut hasher = Sha256::new();
    hasher.update(user.as_bytes());
    hasher.update(b"@");
    hasher.update(hostname.as_bytes());
    hasher.update(b":");
    hasher.update(port.to_string().as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(CONTROL_ID_HEX_LEN / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn path_byte_len(path: &Path) -> usize {
    path.to_string_lossy().len()
}

pub fn require_socket_path_len(path: &Path, hostname: &str) -> Result<(), String> {
    let n = path_byte_len(path);
    if n > MAX_UNIX_SOCKET_BYTES {
        return Err(crate::commands::ssh::errors::socket_path_too_long(
            hostname, n,
        ));
    }
    Ok(())
}

pub fn require_control_path_len(path: &Path, hostname: &str) -> Result<(), String> {
    let n = path_byte_len(path);
    let with_mux_temp = n.saturating_add(CONTROL_PATH_TEMP_MARGIN);
    if n > MAX_UNIX_SOCKET_BYTES || with_mux_temp > MAX_UNIX_SOCKET_BYTES {
        return Err(crate::commands::ssh::errors::socket_path_too_long(
            hostname,
            with_mux_temp.max(n),
        ));
    }
    Ok(())
}

#[cfg(unix)]
pub fn ensure_dir_mode_0700(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    if !path.exists() {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|err| {
                format!(
                    "Could not create SSH directory {path}: {err}",
                    path = path.display()
                )
            })?;
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|err| {
        format!(
            "Could not set mode 0700 on {path}: {err}",
            path = path.display()
        )
    })?;
    let mode = fs::metadata(path)
        .map_err(|err| format!("Could not stat {path}: {err}", path = path.display()))?
        .permissions()
        .mode()
        & 0o777;
    if mode & 0o077 != 0 {
        return Err(format!(
            "SSH directory {path} must be mode 0700. It is mode {mode:o}.",
            path = path.display()
        ));
    }
    Ok(())
}

#[cfg(unix)]
pub fn set_mode_0600(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|err| {
        format!(
            "Could not set mode 0600 on {path}: {err}",
            path = path.display()
        )
    })
}

#[cfg(not(unix))]
pub fn ensure_dir_mode_0700(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| {
        format!(
            "Could not create SSH directory {path}: {err}",
            path = path.display()
        )
    })
}

#[cfg(not(unix))]
pub fn set_mode_0600(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
pub fn file_mode(path: &Path) -> Result<u32, String> {
    use std::os::unix::fs::PermissionsExt;
    Ok(fs::metadata(path)
        .map_err(|err| format!("Could not stat {path}: {err}", path = path.display()))?
        .permissions()
        .mode()
        & 0o777)
}

pub fn quote_ssh_value(value: &str) -> String {
    if value
        .bytes()
        .any(|byte| byte.is_ascii_whitespace() || byte == b'"' || byte == b'\'' || byte == b'\\')
    {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{escaped}\"")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn control_id_is_stable_short_hex() {
        let a = session_control_id("aidanhibbard", "eva.local", 22);
        let b = session_control_id("aidanhibbard", "eva.local", 22);
        let c = session_control_id("aidanhibbard", "eva.local", 2222);
        assert_eq!(a, b);
        assert_eq!(a.len(), CONTROL_ID_HEX_LEN);
        assert_ne!(a, c);
        assert!(a.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn socket_path_over_103_bytes_refuses() {
        let long = "a".repeat(104);
        let err = require_socket_path_len(Path::new(&long), "eva.local").unwrap_err();
        assert!(err.contains("SSH socket path is too long for eva.local"));
        assert!(err.contains("104 bytes"));
        assert!(err.contains("103"));
        let almost = "a".repeat(90);
        let err = require_control_path_len(Path::new(&almost), "eva.local").unwrap_err();
        assert!(err.contains("SSH socket path is too long for eva.local"));
    }

    #[test]
    fn quote_wraps_spaces() {
        assert_eq!(quote_ssh_value("/plain/path"), "/plain/path");
        assert_eq!(quote_ssh_value("/path with space"), "\"/path with space\"");
    }

    #[cfg(unix)]
    #[test]
    fn dir_mode_0700_in_temp() {
        let dir = tempdir().expect("tempdir");
        let ssh_dir = dir.path().join("ssh");
        ensure_dir_mode_0700(&ssh_dir).expect("mkdir");
        assert_eq!(file_mode(&ssh_dir).expect("mode"), 0o700);
    }
}
