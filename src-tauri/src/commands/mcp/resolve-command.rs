use std::env;
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;
use tokio::process::Command;

use crate::commands::lsp_install::{ensure_portable_node, find_node_bin};

static LOGIN_PATH: OnceLock<Option<String>> = OnceLock::new();

const LOGIN_PATH_TIMEOUT: Duration = Duration::from_secs(5);

/// Resolve a PATH basename to an absolute executable.
///
/// Search order: current PATH, login-shell PATH (cached), common install dirs,
/// then portable Node sibling (`npx` / `npm` / `node` only).
pub async fn resolve_command(app: &AppHandle, basename: &str) -> Result<PathBuf, String> {
    let trimmed = basename.trim();
    let current = env::var_os("PATH");
    if let Some(path) = which_on_path(trimmed, current.as_deref()) {
        return Ok(path);
    }

    let login = cached_login_path().map(OsString::from);
    if let Some(path) = which_on_path(trimmed, login.as_deref()) {
        return Ok(path);
    }

    let dirs = common_bin_dirs();
    if let Some(path) = which_on_dirs(trimmed, &dirs) {
        return Ok(path);
    }

    if let Some(path) = portable_sibling(app, trimmed).await {
        return Ok(path);
    }

    Err(format!("Command '{trimmed}' was not found on PATH"))
}

pub(crate) fn apply_resolved_path_env(command: &mut Command, program: &Path) {
    let mut entries = Vec::new();
    if let Some(dir) = program.parent() {
        entries.push(dir.to_path_buf());
    }
    if let Some(login) = LOGIN_PATH.get().and_then(|value| value.as_deref()) {
        entries.extend(env::split_paths(login));
    }
    if let Some(rest) = env::var_os("PATH") {
        entries.extend(env::split_paths(&rest));
    }
    let mut seen = std::collections::HashSet::new();
    entries.retain(|entry| seen.insert(entry.clone()));
    if let Ok(joined) = env::join_paths(entries) {
        command.env("PATH", joined);
    }
}

fn which_on_path(basename: &str, path: Option<&OsStr>) -> Option<PathBuf> {
    which::which_in_global(basename, path)
        .ok()
        .and_then(|mut found| found.next())
}

fn which_on_dirs(basename: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let joined = env::join_paths(dirs.iter()).ok()?;
    which_on_path(basename, Some(joined.as_os_str()))
}

fn cached_login_path() -> Option<&'static str> {
    LOGIN_PATH.get_or_init(fetch_login_shell_path).as_deref()
}

fn fetch_login_shell_path() -> Option<String> {
    let shell = env::var("SHELL").ok()?;
    if shell.trim().is_empty() {
        return None;
    }
    let mut child = std::process::Command::new(&shell)
        .args(["-l", "-c", r#"printf %s "$PATH""#])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let buf = match rx.recv_timeout(LOGIN_PATH_TIMEOUT) {
        Ok(buf) => buf,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let _ = child.wait();
    let path = String::from_utf8(buf).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn common_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".fnm/aliases/default/bin"));
        dirs.push(home.join(".local/share/fnm/aliases/default/bin"));
        dirs.push(home.join(".nodenv/shims"));
        dirs.push(home.join(".asdf/shims"));
        push_versioned_bins(&mut dirs, home.join(".nvm/versions/node"), &["bin"]);
        push_versioned_bins(
            &mut dirs,
            home.join(".fnm/node-versions"),
            &["installation", "bin"],
        );
        push_versioned_bins(
            &mut dirs,
            home.join(".local/share/fnm/node-versions"),
            &["installation", "bin"],
        );
    }
    dirs
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn push_versioned_bins(dirs: &mut Vec<PathBuf>, versions_root: PathBuf, suffix: &[&str]) {
    let Ok(entries) = std::fs::read_dir(&versions_root) else {
        return;
    };
    let mut versions: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    versions.sort_by(|left, right| version_sort_key(right).cmp(&version_sort_key(left)));
    for version_dir in versions {
        let mut bin = version_dir;
        for part in suffix {
            bin.push(part);
        }
        if bin.is_dir() {
            dirs.push(bin);
        }
    }
}

fn version_sort_key(path: &Path) -> (i32, i32, i32) {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim_start_matches('v');
    let mut parts = name.split('.');
    let major = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn is_node_family(basename: &str) -> bool {
    matches!(
        basename.to_ascii_lowercase().as_str(),
        "node" | "npm" | "npx" | "node.exe" | "npm.cmd" | "npx.cmd"
    )
}

async fn portable_sibling(app: &AppHandle, basename: &str) -> Option<PathBuf> {
    if !is_node_family(basename) {
        return None;
    }
    let node = match find_node_bin(app) {
        Some(path) => path,
        None => ensure_portable_node(app).await.ok()?,
    };
    let lower = basename.to_ascii_lowercase();
    if lower == "node" || lower == "node.exe" {
        return if node.is_file() { Some(node) } else { None };
    }
    sibling_bin(&node, basename)
}

fn sibling_bin(node: &Path, basename: &str) -> Option<PathBuf> {
    let dir = node.parent()?;
    let direct = dir.join(basename);
    if direct.is_file() {
        return Some(direct);
    }
    #[cfg(windows)]
    {
        for ext in ["cmd", "exe", "bat"] {
            let candidate = dir.join(format!("{basename}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
fn resolve_on_sources(
    basename: &str,
    current_path: Option<&OsStr>,
    login_path: Option<&OsStr>,
    extra_dirs: &[PathBuf],
    portable_sibling: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let trimmed = basename.trim();
    if let Some(path) = which_on_path(trimmed, current_path) {
        return Ok(path);
    }
    if let Some(path) = which_on_path(trimmed, login_path) {
        return Ok(path);
    }
    if let Some(path) = which_on_dirs(trimmed, extra_dirs) {
        return Ok(path);
    }
    if let Some(path) = portable_sibling.filter(|candidate| candidate.is_file()) {
        return Ok(path);
    }
    Err(format!("Command '{trimmed}' was not found on PATH"))
}

#[cfg(test)]
#[path = "resolve-command-tests.rs"]
mod resolve_command_tests;
