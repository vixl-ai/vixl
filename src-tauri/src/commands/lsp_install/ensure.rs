use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use tokio::sync::Mutex;

use super::super::lsp_registry::{builtin_spec_by_id, tier_a_ids, LspInstallKind, LspTier};
use super::backends::{
    github_install, go_install_package, http_archive_install, npm_install_packages,
};
use super::managed::{managed_bin_path, version_key_for_spec};
use super::node::ensure_portable_node;
use super::paths::{auto_download_enabled, lsp_root, managed_server_dir};
use super::progress::emit_progress;

lazy_static::lazy_static! {
  static ref INSTALL_LOCKS: Mutex<std::collections::HashMap<String, ()>> =
    Mutex::new(std::collections::HashMap::new());
}

pub async fn ensure_server_installed(
    app: &AppHandle,
    server_id: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(spec) = builtin_spec_by_id(server_id) else {
        return Ok(None);
    };

    if !auto_download_enabled(app) {
        return Ok(managed_bin_path(app, spec));
    }

    if spec.tier == LspTier::D || spec.install == LspInstallKind::None {
        return Ok(None);
    }

    if spec.install == LspInstallKind::ToolchainPath {
        let bin = spec.command.first().copied().unwrap_or("");
        return Ok(which::which(bin).ok());
    }

    {
        let mut locks = INSTALL_LOCKS.lock().await;
        if locks.contains_key(server_id) {
            // another install in progress; fall through after release
        }
        locks.insert(server_id.to_string(), ());
    }

    let result = match spec.install {
        LspInstallKind::Npm => npm_install_packages(app, spec).await.map(Some),
        LspInstallKind::GithubRelease => match github_install(app, spec).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => {
                // Allow PATH fallback
                let fallback = which::which(spec.command.first().copied().unwrap_or("")).ok();
                if fallback.is_some() {
                    emit_progress(app, server_id, "path", Some(error));
                    Ok(fallback)
                } else {
                    Err(error)
                }
            }
        },
        LspInstallKind::HttpArchive => match http_archive_install(app, spec).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => {
                let fallback = which::which(spec.command.first().copied().unwrap_or("")).ok();
                if fallback.is_some() {
                    emit_progress(app, server_id, "path", Some(error));
                    Ok(fallback)
                } else {
                    Err(error)
                }
            }
        },
        LspInstallKind::GoInstall => match go_install_package(app, spec).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => {
                let fallback = which::which(spec.command.first().copied().unwrap_or("")).ok();
                if fallback.is_some() {
                    emit_progress(app, server_id, "path", Some(error));
                    Ok(fallback)
                } else {
                    Err(error)
                }
            }
        },
        _ => Ok(None),
    };

    INSTALL_LOCKS.lock().await.remove(server_id);

    match &result {
        Ok(Some(_)) => emit_progress(app, server_id, "ready", None),
        Ok(None) => {}
        Err(error) => emit_progress(app, server_id, "error", Some(error.clone())),
    }

    result
}

pub async fn prefetch_tier_a(app: AppHandle) -> Result<(), String> {
    if !auto_download_enabled(&app) {
        return Ok(());
    }

    emit_progress(
        &app,
        "*",
        "installing",
        Some("Installing language support…".into()),
    );

    // Ensure node once up front for npm servers
    let _ = ensure_portable_node(&app).await;

    for id in tier_a_ids() {
        match ensure_server_installed(&app, id).await {
            Ok(_) => {}
            Err(error) => {
                log::warn!("LSP prefetch failed for {id}: {error}");
                emit_progress(&app, id, "error", Some(error));
            }
        }
    }

    emit_progress(&app, "*", "ready", Some("Language support ready".into()));
    Ok(())
}

#[tauri::command]
pub async fn lsp_prefetch_defaults(app: AppHandle) -> Result<(), String> {
    tokio::spawn(async move {
        let _ = prefetch_tier_a(app).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn lsp_install_server(app: AppHandle, server_id: String) -> Result<(), String> {
    ensure_server_installed(&app, &server_id).await?;
    Ok(())
}

pub fn managed_vue_plugin_path(app: &AppHandle) -> Option<PathBuf> {
    let spec = builtin_spec_by_id("vue")?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, "vue", &key).ok()?;
    // Official Vue LS 3 / Neovim wiki: plugin `location` is the @vue/language-server
    // package root (tsserver resolves @vue/typescript-plugin from there).
    let language_server = dir.join("node_modules/@vue/language-server");
    if language_server.is_dir() {
        return Some(language_server);
    }
    let plugin = dir.join("node_modules/@vue/typescript-plugin");
    if plugin.is_dir() {
        Some(plugin)
    } else {
        None
    }
}

pub fn managed_vue_typescript_lib(app: &AppHandle) -> Option<PathBuf> {
    let spec = builtin_spec_by_id("vue")?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, "vue", &key).ok()?;
    let lib = dir.join("node_modules/typescript/lib");
    if lib.is_dir() {
        Some(lib)
    } else {
        None
    }
}

pub fn managed_typescript_lib(app: &AppHandle) -> Option<PathBuf> {
    let spec = builtin_spec_by_id("typescript")?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, "typescript", &key).ok()?;
    let lib = dir.join("node_modules/typescript/lib");
    if lib.is_dir() {
        Some(lib)
    } else {
        None
    }
}

pub fn install_source_label(app: &AppHandle, server_id: &str) -> String {
    let Some(spec) = builtin_spec_by_id(server_id) else {
        return "none".to_string();
    };
    if managed_bin_path(app, spec).is_some() {
        return "managed".to_string();
    }
    if which::which(spec.command.first().copied().unwrap_or("")).is_ok() {
        return "path".to_string();
    }
    "none".to_string()
}

/// Remove managed install cache for a server. Fails for PATH/toolchain-only servers.
pub fn remove_managed_install(app: &AppHandle, server_id: &str) -> Result<(), String> {
    let spec = builtin_spec_by_id(server_id)
        .ok_or_else(|| format!("Unknown language server: {server_id}"))?;
    if !matches!(
        spec.install,
        LspInstallKind::Npm
            | LspInstallKind::GithubRelease
            | LspInstallKind::HttpArchive
            | LspInstallKind::GoInstall
    ) {
        return Err(
            "Uninstall only applies to managed downloads. PATH/toolchain servers are not removed."
                .to_string(),
        );
    }
    let root = lsp_root(app)?.join(server_id);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| {
            format!("Failed to remove managed language server '{server_id}': {error}")
        })?;
    }
    Ok(())
}
