use std::process::Command;

use serde::Serialize;

use super::argv::{build_ssh_argv, ArgvRequest, ControlMasterMode, SshInvocation, TtyMode};
use super::config::parse_host_aliases;
use super::errors;
use super::paths::{SshPaths, SSH_BIN};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshPreview {
    pub destination: String,
    pub user: String,
    pub hostname: String,
    pub port: u16,
    pub identity_files: Vec<String>,
    pub identities_only: bool,
    pub saw_match: bool,
    pub confirm_body: String,
}

pub fn preview_destination(
    paths: &SshPaths,
    destination: &str,
    port: Option<u16>,
    identity_file: Option<&str>,
    config_file: Option<&str>,
) -> Result<SshPreview, String> {
    let vixl_known = paths.known_hosts();
    let user_known = paths.user_known_hosts();
    let argv = build_ssh_argv(ArgvRequest {
        destination,
        control_path: None,
        control_master: ControlMasterMode::No,
        tty: TtyMode::No,
        vixl_known_hosts: &vixl_known.to_string_lossy(),
        user_known_hosts: &user_known.to_string_lossy(),
        password_only: false,
        port,
        identity_file,
        invocation: SshInvocation::Preview,
        config_file,
    });
    let output = Command::new(SSH_BIN)
        .args(&argv.args)
        .output()
        .map_err(|err| errors::ssh_missing(destination, &err.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(errors::preview_failed(destination, stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut preview = parse_g_output(destination, &stdout);
    if let Some(forced_port) = port {
        preview.port = forced_port;
    }
    let config_path = config_file
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| paths.user_config());
    if config_path.exists() {
        preview.saw_match = parse_host_aliases(&config_path).saw_match;
    }
    preview.confirm_body = build_confirm_body(&preview, destination);
    Ok(preview)
}

fn parse_g_output(destination: &str, stdout: &str) -> SshPreview {
    let mut user = String::new();
    let mut hostname = String::new();
    let mut port = 22u16;
    let mut identity_files = Vec::new();
    let mut identities_only = false;
    for line in stdout.lines() {
        let Some((key, value)) = split_g_line(line) else {
            continue;
        };
        match key {
            "user" => user = value.to_string(),
            "hostname" => hostname = value.to_string(),
            "port" => {
                if let Ok(parsed) = value.parse() {
                    port = parsed;
                }
            }
            "identityfile" => identity_files.push(value.to_string()),
            "identitiesonly" => identities_only = value.eq_ignore_ascii_case("yes"),
            _ => {}
        }
    }
    if hostname.is_empty() {
        hostname = destination.to_string();
    }
    SshPreview {
        destination: destination.to_string(),
        user,
        hostname,
        port,
        identity_files,
        identities_only,
        saw_match: false,
        confirm_body: String::new(),
    }
}

fn split_g_line(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.splitn(2, char::is_whitespace);
    let key = parts.next()?;
    let value = parts.next().unwrap_or("").trim();
    Some((key, value))
}

fn build_confirm_body(preview: &SshPreview, typed: &str) -> String {
    let mut body = format!(
        "OpenSSH will connect as {user} to {host} port {port}",
        user = if preview.user.is_empty() {
            "the default user"
        } else {
            &preview.user
        },
        host = preview.hostname,
        port = preview.port
    );
    if !preview.identity_files.is_empty() {
        let names: Vec<String> = preview
            .identity_files
            .iter()
            .map(|path| {
                std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path)
                    .to_string()
            })
            .collect();
        body.push_str(", with identity ");
        body.push_str(&names.join(", "));
    }
    body.push('.');
    if typed != preview.hostname
        && !typed.contains(&preview.hostname)
        && !typed.contains('@')
        && typed != preview.destination
    {
        body.push_str(&format!(" The {typed} alias was not used."));
    }
    if preview.identities_only {
        body.push_str(" IdentitiesOnly is yes.");
    } else {
        body.push_str(" IdentitiesOnly is no. Other agent keys can be offered.");
    }
    if preview.saw_match {
        body.push_str(" OpenSSH will apply Match when it connects.");
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_g_extracts_identity() {
        let preview = parse_g_output(
            "eva",
            "user aidanhibbard\nhostname eva.local\nport 22\nidentityfile ~/.ssh/id_ed25519\nidentitiesonly no\n",
        );
        assert_eq!(preview.user, "aidanhibbard");
        assert_eq!(preview.hostname, "eva.local");
        assert_eq!(preview.port, 22);
        assert_eq!(
            preview.identity_files,
            vec!["~/.ssh/id_ed25519".to_string()]
        );
        assert!(!preview.identities_only);
    }
}
