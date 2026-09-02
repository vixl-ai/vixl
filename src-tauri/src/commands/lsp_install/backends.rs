use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tauri::AppHandle;
use tokio::process::Command as TokioCommand;

use super::super::lsp_registry::{BuiltinLspSpec, GithubTargetStyle};
use super::archive::{
    extract_archive_bytes, extract_tar_gz_bytes, extract_tar_xz_bytes, extract_zip_bytes,
    write_gzip_file,
};
use super::managed::{find_file_named, managed_bin_path, version_key_for_spec};
use super::node::{download_bytes, ensure_portable_node};
use super::paths::managed_server_dir;
use super::progress::emit_progress;
use super::resolve::{github_target_token, resolve_github_asset, resolve_http_archive_url};
use super::timeout::{with_timeout, INSTALL_TIMEOUT};

async fn timed_output(command: &mut TokioCommand) -> Result<std::process::Output, String> {
    command.kill_on_drop(true);
    let timeout_message = format!(
        "Language server install timed out after {}s",
        INSTALL_TIMEOUT.as_secs()
    );
    with_timeout(
        INSTALL_TIMEOUT,
        async { command.output().await.map_err(|e| e.to_string()) },
        &timeout_message,
    )
    .await
}

pub(crate) async fn npm_install_packages(
    app: &AppHandle,
    spec: &BuiltinLspSpec,
) -> Result<PathBuf, String> {
    let npm = spec
        .npm
        .as_ref()
        .ok_or_else(|| format!("Server {} has no npm install spec", spec.id))?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec.id, &key)?;
    let marker = dir.join(".installed");
    if marker.is_file() && managed_bin_path(app, spec).is_some() {
        return managed_bin_path(app, spec).ok_or_else(|| "Managed bin missing".to_string());
    }

    let node = ensure_portable_node(app).await?;
    let npm_cli = node
        .parent()
        .map(|p| {
            if cfg!(windows) {
                p.join("npm.cmd")
            } else {
                // Portable node layout: bin/node, npm may be sibling or via node + npm package
                p.join("npm")
            }
        })
        .filter(|p| p.exists());

    emit_progress(
        app,
        spec.id,
        "installing",
        Some(format!("Installing {}", spec.id)),
    );

    let npm_args = [
        vec![
            "install".to_string(),
            "--prefix".to_string(),
            dir.to_string_lossy().to_string(),
            "--no-fund".to_string(),
            "--no-audit".to_string(),
        ],
        npm.packages.iter().map(|p| (*p).to_string()).collect(),
    ]
    .concat();

    // Prefer `node /path/to/npm` style via corepack/npm from PATH, else node -e with npx-like install
    let output = if let Some(npm_bin) = npm_cli {
        let mut cmd = TokioCommand::new(npm_bin);
        cmd.args(&npm_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        timed_output(&mut cmd).await?
    } else if let Ok(system_npm) = which::which("npm") {
        let mut cmd = TokioCommand::new(system_npm);
        cmd.args(&npm_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        timed_output(&mut cmd).await?
    } else {
        // Bootstrap: download packages using node + built-in fetch via a tiny install script is heavy.
        // Fall back: require npm on PATH for first install after portable node without npm.
        return Err(
      "npm is required to install language servers. Install Node.js (includes npm) or ensure npm is on PATH."
        .to_string(),
    );
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let truncated: String = stderr.chars().take(500).collect();
        let detail = truncated.trim();
        if detail.is_empty() {
            return Err(format!("npm install failed for {}", spec.id));
        }
        return Err(format!("npm install failed for {}: {detail}", spec.id));
    }

    fs::write(&marker, b"ok").map_err(|e| e.to_string())?;
    managed_bin_path(app, spec).ok_or_else(|| format!("Installed {} but bin missing", spec.id))
}

pub(crate) async fn github_install(
    app: &AppHandle,
    spec: &BuiltinLspSpec,
) -> Result<PathBuf, String> {
    let github = spec
        .github
        .as_ref()
        .ok_or_else(|| format!("Server {} has no github install spec", spec.id))?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec.id, &key)?;
    if let Some(existing) = managed_bin_path(app, spec) {
        return Ok(existing);
    }

    emit_progress(
        app,
        spec.id,
        "installing",
        Some(format!("Downloading {}", spec.id)),
    );

    let (url, _asset) = resolve_github_asset(github)?;
    let bytes = download_bytes(&url).await.map_err(|e| {
        format!(
            "Failed to download {} from GitHub ({e}). Falling back to PATH if available.",
            spec.id
        )
    })?;

    let dest_name = Path::new(github.binary_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(github.binary_name);
    let dest = dir.join(dest_name);

    if github.gzip || url.ends_with(".gz") && !url.ends_with(".tar.gz") {
        write_gzip_file(&bytes, &dest)?;
    } else if url.ends_with(".tar.xz") {
        extract_tar_xz_bytes(&bytes, &dir)?;
    } else if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
        extract_tar_gz_bytes(&bytes, &dir)?;
    } else if url.ends_with(".zip") {
        extract_zip_bytes(&bytes, &dir)?;
    } else {
        fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&dest)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
        }
    }

    // lemminx archives name the binary lemminx-{target}; normalize to binary_name.
    if github.target_style == GithubTargetStyle::LemminxOs {
        normalize_lemminx_binary(&dir, github.binary_name)?;
    }

    #[cfg(unix)]
    if let Some(bin) = managed_bin_path(app, spec) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).map_err(|e| e.to_string())?;
    }

    managed_bin_path(app, spec).ok_or_else(|| format!("Downloaded {} but binary missing", spec.id))
}

pub(crate) fn normalize_lemminx_binary(dir: &Path, binary_name: &str) -> Result<(), String> {
    let dest = dir.join(binary_name);
    if dest.is_file() {
        return Ok(());
    }
    let target = github_target_token(GithubTargetStyle::LemminxOs)?;
    let platform_name = if cfg!(windows) {
        format!("lemminx-{target}.exe")
    } else {
        format!("lemminx-{target}")
    };
    let source = dir
        .join(&platform_name)
        .canonicalize()
        .ok()
        .filter(|path| path.is_file())
        .or_else(|| find_file_named(dir, &platform_name));
    let Some(source) = source else {
        return Ok(());
    };
    if source == dest {
        return Ok(());
    }
    fs::rename(&source, &dest).map_err(|e| format!("Failed to normalize lemminx binary: {e}"))?;
    Ok(())
}

pub(crate) async fn http_archive_install(
    app: &AppHandle,
    spec: &BuiltinLspSpec,
) -> Result<PathBuf, String> {
    let http = spec
        .http
        .as_ref()
        .ok_or_else(|| format!("Server {} has no http archive install spec", spec.id))?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec.id, &key)?;
    if let Some(existing) = managed_bin_path(app, spec) {
        if spec.id == "java" && which::which("java").is_err() {
            return Err(
        "jdtls is installed but Java (JDK) was not found on PATH. Install a JDK to use Java language support."
          .to_string(),
      );
        }
        return Ok(existing);
    }

    emit_progress(
        app,
        spec.id,
        "installing",
        Some(format!("Downloading {}", spec.id)),
    );

    let url = resolve_http_archive_url(http)?;
    let bytes = download_bytes(&url).await.map_err(|e| {
        format!(
            "Failed to download {} ({e}). Falling back to PATH if available.",
            spec.id
        )
    })?;

    extract_archive_bytes(&bytes, &url, &dir)?;

    #[cfg(unix)]
    if let Some(bin) = managed_bin_path(app, spec) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).map_err(|e| e.to_string())?;
    }

    let path = managed_bin_path(app, spec)
        .ok_or_else(|| format!("Downloaded {} but binary missing", spec.id))?;

    if spec.id == "java" && which::which("java").is_err() {
        return Err(
      "jdtls downloaded but Java (JDK) was not found on PATH. Install a JDK to use Java language support."
        .to_string(),
    );
    }

    Ok(path)
}

pub(crate) async fn go_install_package(
    app: &AppHandle,
    spec: &BuiltinLspSpec,
) -> Result<PathBuf, String> {
    let go_spec = spec
        .go
        .as_ref()
        .ok_or_else(|| format!("Server {} has no go install spec", spec.id))?;
    let key = version_key_for_spec(spec);
    let dir = managed_server_dir(app, spec.id, &key)?;
    if let Some(existing) = managed_bin_path(app, spec) {
        return Ok(existing);
    }

    let go_bin = which::which("go").map_err(|_| {
        format!(
            "Go is required to install {}. Install Go and ensure `go` is on PATH, then try again.",
            spec.id
        )
    })?;

    emit_progress(
        app,
        spec.id,
        "installing",
        Some(format!("Running go install for {}", spec.id)),
    );

    let mut go_cmd = TokioCommand::new(go_bin);
    go_cmd
        .args(["install", go_spec.package])
        .env("GOBIN", &dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = timed_output(&mut go_cmd).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let truncated: String = stderr.chars().take(500).collect();
        return Err(format!(
            "go install failed for {}: {}",
            spec.id,
            truncated.trim()
        ));
    }

    #[cfg(unix)]
    if let Some(bin) = managed_bin_path(app, spec) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).map_err(|e| e.to_string())?;
    }

    managed_bin_path(app, spec).ok_or_else(|| format!("Installed {} but binary missing", spec.id))
}
