use std::fs;
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::super::lsp_registry::{BuiltinLspSpec, GithubTargetStyle, LspInstallKind};
use super::paths::managed_server_dir;
use super::resolve::{github_target_token, host_asset_target};

pub(crate) fn version_key_for_spec(spec: &BuiltinLspSpec) -> String {
    match spec.install {
        LspInstallKind::Npm => spec
            .npm
            .as_ref()
            .map(|n| n.packages.join("+"))
            .unwrap_or_else(|| "latest".to_string())
            .replace(['@', '/', ':'], "_"),
        LspInstallKind::GithubRelease => spec
            .github
            .as_ref()
            .map(|g| format!("{}_{}", g.tag.replace('/', "_"), host_asset_target()))
            .unwrap_or_else(|| "latest".to_string()),
        LspInstallKind::HttpArchive => spec
            .http
            .as_ref()
            .map(|h| h.version_key.to_string())
            .unwrap_or_else(|| "latest".to_string()),
        LspInstallKind::GoInstall => spec
            .go
            .as_ref()
            .map(|g| g.version_key.to_string())
            .unwrap_or_else(|| "latest".to_string()),
        _ => "path".to_string(),
    }
}

pub fn managed_bin_path(app: &AppHandle, spec: &BuiltinLspSpec) -> Option<PathBuf> {
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec.id, &key).ok()?;
    match spec.install {
        LspInstallKind::Npm => {
            let npm = spec.npm.as_ref()?;
            let candidate = dir.join(npm.bin);
            if candidate.is_file() {
                Some(candidate)
            } else {
                None
            }
        }
        LspInstallKind::GithubRelease => {
            let github = spec.github.as_ref()?;
            let candidate = dir.join(github.binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
            // Some archives nest under a top folder
            let nested = dir.join(
                github
                    .binary_name
                    .rsplit('/')
                    .next()
                    .unwrap_or(github.binary_name),
            );
            if nested.is_file() {
                return Some(nested);
            }
            // lemminx ships as lemminx-{target} (and lemminx-{target}.exe on Windows).
            if github.target_style == GithubTargetStyle::LemminxOs {
                if let Ok(target) = github_target_token(GithubTargetStyle::LemminxOs) {
                    let platform_name = if cfg!(windows) {
                        format!("lemminx-{target}.exe")
                    } else {
                        format!("lemminx-{target}")
                    };
                    let platform_bin = dir.join(&platform_name);
                    if platform_bin.is_file() {
                        return Some(platform_bin);
                    }
                    if let Some(found) = find_file_named(&dir, &platform_name) {
                        return Some(found);
                    }
                }
            }
            find_file_named(&dir, Path::new(github.binary_name).file_name()?.to_str()?)
        }
        LspInstallKind::HttpArchive => {
            let http = spec.http.as_ref()?;
            let candidate = dir.join(http.binary_name);
            if candidate.is_file() {
                Some(candidate)
            } else {
                find_file_named(&dir, Path::new(http.binary_name).file_name()?.to_str()?)
            }
        }
        LspInstallKind::GoInstall => {
            let go = spec.go.as_ref()?;
            let candidate = dir.join(go.binary_name);
            if candidate.is_file() {
                Some(candidate)
            } else if cfg!(windows) {
                let exe = dir.join(format!("{}.exe", go.binary_name));
                if exe.is_file() {
                    Some(exe)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

pub(crate) fn find_file_named(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
                return Some(path);
            }
        }
    }
    None
}

#[allow(dead_code)]
pub fn is_installed(app: &AppHandle, spec: &BuiltinLspSpec) -> bool {
    match spec.install {
        LspInstallKind::Npm
        | LspInstallKind::GithubRelease
        | LspInstallKind::HttpArchive
        | LspInstallKind::GoInstall => managed_bin_path(app, spec).is_some(),
        LspInstallKind::ToolchainPath => {
            which::which(spec.command.first().copied().unwrap_or("")).is_ok()
        }
        LspInstallKind::None => false,
    }
}
