use std::fs;
use std::io::Write;
use std::path::Path;

use super::paths::SshPaths;

pub fn snapshot_known_hosts(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub fn new_known_host_lines(before: &str, after: &str) -> Vec<String> {
    let before_set: Vec<&str> = before.lines().collect();
    after
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !before_set.iter().any(|old| old == line)
        })
        .map(|line| line.to_string())
        .collect()
}

pub fn append_user_known_host_line(user_known_hosts: &Path, line: &str) -> Result<(), String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err("No host key line to add".to_string());
    }
    if let Some(parent) = user_known_hosts.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create {}: {err}", parent.display()))?;
    }
    let mut opts = fs::OpenOptions::new();
    opts.create(true).append(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(user_known_hosts)
        .map_err(|err| format!("Could not open {}: {err}", user_known_hosts.display()))?;
    let mut payload = trimmed.to_string();
    payload.push('\n');
    file.write_all(payload.as_bytes())
        .map_err(|err| format!("Could not append host key: {err}"))?;
    file.sync_all()
        .map_err(|err| format!("Could not sync host key: {err}"))?;
    Ok(())
}

pub fn also_add_new_vixl_lines(
    paths: &SshPaths,
    before_vixl: &str,
    also_add: bool,
) -> Result<Vec<String>, String> {
    let after = snapshot_known_hosts(&paths.known_hosts());
    let new_lines = new_known_host_lines(before_vixl, &after);
    if also_add {
        for line in &new_lines {
            append_user_known_host_line(&paths.user_known_hosts(), line)?;
        }
    }
    Ok(new_lines)
}

pub fn host_match_token(hostname: &str, port: u16) -> String {
    if port == 22 {
        hostname.to_string()
    } else {
        format!("[{hostname}]:{port}")
    }
}

pub fn line_matches_host(line: &str, hostname: &str, port: u16) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return false;
    }
    let Some(names) = trimmed.split_whitespace().next() else {
        return false;
    };
    let token = host_match_token(hostname, port);
    names.split(',').any(|name| name == token)
}

pub fn remove_vixl_known_host_lines(
    vixl_known_hosts: &Path,
    hostname: &str,
    port: u16,
) -> Result<usize, String> {
    let text = match fs::read_to_string(vixl_known_hosts) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => {
            return Err(format!(
                "Could not read {}: {err}",
                vixl_known_hosts.display()
            ))
        }
    };
    let mut kept = Vec::new();
    let mut removed = 0usize;
    for line in text.lines() {
        if line_matches_host(line, hostname, port) {
            removed += 1;
            continue;
        }
        kept.push(line);
    }
    let mut out = kept.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    fs::write(vixl_known_hosts, out)
        .map_err(|err| format!("Could not write {}: {err}", vixl_known_hosts.display()))?;
    Ok(removed)
}

pub fn parse_confirm_metadata(prompt: &str, stderr: &str) -> ConfirmHostMeta {
    let combined = format!("{stderr}\n{prompt}");
    ConfirmHostMeta {
        fingerprint: extract_fingerprint(&combined),
        key_type: extract_key_type(&combined),
        host: extract_host(&combined),
        port: extract_port(&combined),
        address: extract_address(&combined),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConfirmHostMeta {
    pub fingerprint: Option<String>,
    pub key_type: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub address: Option<String>,
}

fn extract_fingerprint(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Some(rest) = line.split("SHA256:").nth(1) {
            let value = rest.split_whitespace().next()?.trim();
            if !value.is_empty() {
                return Some(format!("SHA256:{value}"));
            }
        }
    }
    None
}

fn extract_key_type(text: &str) -> Option<String> {
    for candidate in ["ED25519", "ECDSA", "RSA", "DSA"] {
        if text.to_ascii_uppercase().contains(candidate) {
            return Some(candidate.to_string());
        }
    }
    None
}

fn extract_host(text: &str) -> Option<String> {
    let marker = "authenticity of host '";
    let lower = text.to_ascii_lowercase();
    let idx = lower.find(marker)?;
    let rest = &text[idx + marker.len()..];
    let name = rest
        .split(|ch| ch == '\'' || ch == ' ' || ch == '(')
        .next()?;
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn extract_port(text: &str) -> Option<u16> {
    let lower = text.to_ascii_lowercase();
    if let Some(idx) = lower.find("port ") {
        let rest = &text[idx + 5..];
        let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        return digits.parse().ok();
    }
    None
}

fn extract_address(text: &str) -> Option<String> {
    let start = text.find('(')?;
    let rest = &text[start + 1..];
    let end = rest.find(')')?;
    let address = rest[..end].trim();
    if address.is_empty() {
        None
    } else {
        Some(address.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn new_key_write_stays_on_vixl_unless_also_add() {
        let dir = tempdir().expect("tempdir");
        let vixl_ssh = dir.path().join("vixl-ssh");
        let user_ssh = dir.path().join("user-ssh");
        fs::create_dir_all(&vixl_ssh).expect("vixl");
        fs::create_dir_all(&user_ssh).expect("user");
        let paths = SshPaths::from_roots(vixl_ssh, user_ssh);
        let line = "eva.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureKeyNotReal";
        fs::write(paths.known_hosts(), format!("{line}\n")).expect("vixl write");
        also_add_new_vixl_lines(&paths, "", false).expect("no also add");
        assert!(!paths.user_known_hosts().exists());
        also_add_new_vixl_lines(&paths, "", true).expect("also add");
        let user_text = fs::read_to_string(paths.user_known_hosts()).expect("user read");
        assert!(user_text.contains(line));
        let vixl_text = fs::read_to_string(paths.known_hosts()).expect("vixl read");
        assert!(vixl_text.contains(line));
    }

    #[test]
    fn remove_vixl_line_does_not_touch_user_file() {
        let dir = tempdir().expect("tempdir");
        let vixl = dir.path().join("known_hosts");
        let user = dir.path().join("user_known_hosts");
        let vixl_line = "eva.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIVixlLine";
        let user_line = "eva.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIUserLine";
        fs::write(
            &vixl,
            format!("{vixl_line}\nother.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther\n"),
        )
        .expect("vixl");
        fs::write(&user, format!("{user_line}\n")).expect("user");
        let removed = remove_vixl_known_host_lines(&vixl, "eva.local", 22).expect("remove");
        assert_eq!(removed, 1);
        let vixl_text = fs::read_to_string(&vixl).expect("read vixl");
        assert!(!vixl_text.contains("IVixlLine"));
        assert!(vixl_text.contains("other.example"));
        let user_text = fs::read_to_string(&user).expect("read user");
        assert!(user_text.contains("IUserLine"));
    }

    #[test]
    fn remove_nonstandard_port_keeps_the_port_22_line() {
        let dir = tempdir().expect("tempdir");
        let vixl = dir.path().join("known_hosts");
        fs::write(
            &vixl,
            "[appleseed.example]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAlt\nappleseed.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDefault\n",
        )
        .expect("write");
        let removed =
            remove_vixl_known_host_lines(&vixl, "appleseed.example", 2222).expect("remove");
        assert_eq!(removed, 1);
        let text = fs::read_to_string(&vixl).expect("read");
        assert!(!text.contains("IAlt"));
        assert!(text.contains("IDefault"));
        let removed_default =
            remove_vixl_known_host_lines(&vixl, "appleseed.example", 22).expect("remove 22");
        assert_eq!(removed_default, 1);
        let text = fs::read_to_string(&vixl).expect("read");
        assert!(!text.contains("IDefault"));
    }
}
