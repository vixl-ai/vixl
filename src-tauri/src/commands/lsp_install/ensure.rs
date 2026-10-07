use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tauri::AppHandle;
use tokio::sync::Mutex;

use super::super::lsp_registry::{
    builtin_spec_by_id, tier_a_ids, BuiltinLspSpec, LspInstallKind, LspTier,
};
use super::backends::{
    github_install, go_install_package, http_archive_install, npm_install_packages,
};
use super::managed::{managed_bin_path, version_key_for_spec};
use super::named_lock::named_lock_for;
use super::node::ensure_portable_node;
use super::paths::{auto_download_enabled, lsp_root, managed_server_dir};
use super::progress::{emit_progress, InstallMonitor};

lazy_static::lazy_static! {
  static ref INSTALL_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> =
    Mutex::new(HashMap::new());
}

pub async fn ensure_server_installed(
    app: &AppHandle,
    server_id: &str,
    generation: u64,
    settle: bool,
) -> Result<Option<String>, String> {
    let Some(spec) = builtin_spec_by_id(server_id) else {
        return Ok(None);
    };

    if !auto_download_enabled(app) {
        return Ok(None);
    }

    if spec.tier == LspTier::D || spec.install == LspInstallKind::None {
        return Ok(None);
    }

    if spec.install == LspInstallKind::ToolchainPath {
        return Ok(None);
    }

    let install_lock = named_lock_for(&INSTALL_LOCKS, server_id).await;
    let _install_guard = install_lock.lock().await;
    // settle publishes Idle or Error, so those writes must leave a live row alone.
    // Ensure passes false while Starting and still needs Installing.
    let monitor = InstallMonitor::new(app.clone(), generation, settle);
    let started = Instant::now();

    let mut path_fallback = None;
    let result = match spec.install {
        LspInstallKind::Npm => npm_install_packages(app, spec, &monitor).await.map(Some),
        LspInstallKind::GithubRelease => match github_install(app, spec, &monitor).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => path_or_error(spec, error, &mut path_fallback),
        },
        LspInstallKind::HttpArchive => match http_archive_install(app, spec, &monitor).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => path_or_error(spec, error, &mut path_fallback),
        },
        LspInstallKind::GoInstall => match go_install_package(app, spec, &monitor).await {
            Ok(path) => Ok(Some(path)),
            Err(error) => path_or_error(spec, error, &mut path_fallback),
        },
        _ => Ok(None),
    };

    let elapsed_ms = started.elapsed().as_millis();
    log_install_result(
        server_id,
        elapsed_ms,
        monitor.began(),
        &result,
        &path_fallback,
    );

    if settle {
        let (error, path_message) = match &result {
            Ok(_) => (None, path_fallback.clone()),
            Err(error) => (Some(error.clone()), None),
        };
        crate::commands::lsp::finish_standalone_install(
            app,
            server_id,
            generation,
            monitor.began(),
            error,
            path_message,
        )
        .await;
    }

    result.map(|_| path_fallback)
}

fn path_or_error(
    spec: &BuiltinLspSpec,
    error: String,
    path_fallback: &mut Option<String>,
) -> Result<Option<PathBuf>, String> {
    let fallback = which::which(spec.command.first().copied().unwrap_or("")).ok();
    if fallback.is_some() {
        *path_fallback = Some(error);
        Ok(fallback)
    } else {
        Err(error)
    }
}

fn log_install_result(
    server_id: &str,
    elapsed_ms: u128,
    began: bool,
    result: &Result<Option<PathBuf>, String>,
    path_fallback: &Option<String>,
) {
    if let Err(error) = result {
        log::warn!("install failed for {server_id} in {elapsed_ms}ms: {error}");
        return;
    }
    if path_fallback.is_some() {
        log::info!("install fell back to PATH for {server_id} in {elapsed_ms}ms");
        return;
    }
    if began {
        log::info!("installed {server_id} in {elapsed_ms}ms");
    }
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
        let generation = crate::commands::lsp::current_generation(id).await;
        match ensure_server_installed(&app, id, generation, true).await {
            Ok(_) => {}
            Err(error) => {
                log::warn!("prefetch failed for {id}: {error}");
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
    let generation = crate::commands::lsp::current_generation(&server_id).await;
    ensure_server_installed(&app, &server_id, generation, true).await?;
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
    managed_spec_typescript_lib(app, "vue")
}

pub fn managed_astro_typescript_lib(app: &AppHandle) -> Option<PathBuf> {
    managed_spec_typescript_lib(app, "astro")
}

pub fn managed_typescript_lib(app: &AppHandle) -> Option<PathBuf> {
    managed_spec_typescript_lib(app, "typescript")
}

pub fn managed_classic_typescript_lib(app: &AppHandle) -> Option<PathBuf> {
    managed_spec_typescript_lib(app, "typescript-classic")
}

fn managed_spec_typescript_lib(app: &AppHandle, spec_id: &str) -> Option<PathBuf> {
    let spec = builtin_spec_by_id(spec_id)?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec_id, &key).ok()?;
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
    if server_id == "typescript" {
        if let Some(classic) = builtin_spec_by_id("typescript-classic") {
            if managed_bin_path(app, classic).is_some() {
                return "managed".to_string();
            }
        }
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
