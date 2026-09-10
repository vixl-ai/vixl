use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tokio::process::Command as TokioCommand;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NpmEntry {
    NodeScript(PathBuf),
    WindowsCmd(PathBuf),
}

fn is_cmd_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("cmd"))
        .unwrap_or(false)
}

fn sibling_npm(node: &Path) -> Option<PathBuf> {
    let dir = node.parent()?;
    let npm = dir.join("npm");
    let npm_cmd = dir.join("npm.cmd");
    if npm.is_file() {
        return Some(npm);
    }
    if npm_cmd.is_file() {
        return Some(npm_cmd);
    }
    None
}

fn unix_js_from_script(script: &Path) -> Option<NpmEntry> {
    if is_cmd_path(script) {
        return None;
    }
    if let Ok(canonical) = script.canonicalize() {
        if canonical.is_file() {
            return Some(NpmEntry::NodeScript(canonical));
        }
    }
    if script.is_file() {
        return Some(NpmEntry::NodeScript(script.to_path_buf()));
    }
    None
}

pub(crate) fn resolve_unix_npm_entry(node: &Path, npm_script: Option<&Path>) -> Option<NpmEntry> {
    let script = match npm_script {
        Some(path) => path.to_path_buf(),
        None => sibling_npm(node)?,
    };
    unix_js_from_script(&script)
}

pub(crate) fn resolve_windows_npm_entry(
    node: &Path,
    npm_script: Option<&Path>,
) -> Option<NpmEntry> {
    let cli = node
        .parent()?
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if cli.is_file() {
        return Some(NpmEntry::NodeScript(cli));
    }
    let script = match npm_script {
        Some(path) => path.to_path_buf(),
        None => sibling_npm(node)?,
    };
    if is_cmd_path(&script) && script.is_file() {
        return Some(NpmEntry::WindowsCmd(script));
    }
    if script.is_file() {
        return Some(NpmEntry::NodeScript(script));
    }
    None
}

pub(crate) fn resolve_npm_entry(node: &Path, npm_script: Option<&Path>) -> Option<NpmEntry> {
    if cfg!(windows) {
        resolve_windows_npm_entry(node, npm_script)
    } else {
        resolve_unix_npm_entry(node, npm_script)
    }
}

fn find_npm_on_merged_path() -> Option<PathBuf> {
    match crate::commands::mcp::merged_shell_path() {
        Some(path) => which::which_in_global("npm", Some(path))
            .ok()
            .and_then(|mut found| found.next()),
        None => which::which("npm").ok(),
    }
}

fn npm_child_path(node: &Path) -> Option<OsString> {
    let mut entries = Vec::new();
    if let Some(dir) = node.parent() {
        entries.push(dir.to_path_buf());
    }
    let rest = crate::commands::mcp::merged_shell_path().or_else(|| env::var_os("PATH"));
    if let Some(rest) = rest {
        entries.extend(env::split_paths(&rest));
    }
    let mut seen = HashSet::new();
    entries.retain(|entry| seen.insert(entry.clone()));
    env::join_paths(entries).ok()
}

fn apply_npm_child_path(command: &mut TokioCommand, node: &Path) {
    if let Some(path) = npm_child_path(node) {
        command.env("PATH", path);
    }
}

pub fn npm_install_command(
    node: &Path,
    npm_script: Option<&Path>,
    args: &[String],
) -> Option<TokioCommand> {
    let entry = resolve_npm_entry(node, npm_script).or_else(|| {
        let system_npm = find_npm_on_merged_path()?;
        resolve_npm_entry(node, Some(&system_npm))
    })?;
    let mut command = match entry {
        NpmEntry::NodeScript(cli) => {
            let mut command = TokioCommand::new(node);
            command.arg(cli);
            command.args(args);
            command
        }
        NpmEntry::WindowsCmd(npm_cmd) => {
            let mut command = TokioCommand::new(npm_cmd);
            command.args(args);
            command
        }
    };
    apply_npm_child_path(&mut command, node);
    Some(command)
}

#[cfg(test)]
#[path = "npm_command_tests.rs"]
mod npm_command_tests;
