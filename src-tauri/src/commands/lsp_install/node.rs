use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use super::archive::{extract_tar_gz_bytes, extract_zip_bytes};
use super::paths::runtime_node_dir;
use super::progress::emit_progress;




fn node_dist_name() -> Result<String, String> {
  let version = "v22.14.0";
  match (std::env::consts::OS, std::env::consts::ARCH) {
    ("macos", "aarch64") => Ok(format!("node-{version}-darwin-arm64")),
    ("macos", "x86_64") => Ok(format!("node-{version}-darwin-x64")),
    ("linux", "aarch64") => Ok(format!("node-{version}-linux-arm64")),
    ("linux", "x86_64") => Ok(format!("node-{version}-linux-x64")),
    ("windows", "x86_64") => Ok(format!("node-{version}-win-x64")),
    _ => Err(format!(
      "Unsupported platform for portable Node: {} {}",
      std::env::consts::OS,
      std::env::consts::ARCH
    )),
  }
}

fn find_system_node() -> Option<PathBuf> {
  which::which("node").ok()
}

pub fn find_node_bin(app: &AppHandle) -> Option<PathBuf> {
  if let Some(system) = find_system_node() {
    return Some(system);
  }
  let dist = node_dist_name().ok()?;
  let runtime = runtime_node_dir(app).ok()?.join(dist);
  let node_bin = if cfg!(windows) {
    runtime.join("node.exe")
  } else {
    runtime.join("bin").join("node")
  };
  if node_bin.is_file() {
    Some(node_bin)
  } else {
    None
  }
}

pub async fn ensure_portable_node(app: &AppHandle) -> Result<PathBuf, String> {
  if let Some(system) = find_system_node() {
    return Ok(system);
  }

  let dist = node_dist_name()?;
  let runtime = runtime_node_dir(app)?.join(&dist);
  let node_bin = if cfg!(windows) {
    runtime.join("node.exe")
  } else {
    runtime.join("bin").join("node")
  };

  if node_bin.is_file() {
    return Ok(node_bin);
  }

  emit_progress(app, "node", "installing", Some("Downloading portable Node".into()));

  let archive_name = if cfg!(windows) {
    format!("{dist}.zip")
  } else {
    format!("{dist}.tar.gz")
  };
  let url = format!("https://nodejs.org/dist/v22.14.0/{archive_name}");
  let bytes = download_bytes(&url).await?;
  let parent = runtime_node_dir(app)?;

  if cfg!(windows) {
    extract_zip_bytes(&bytes, &parent)?;
  } else {
    extract_tar_gz_bytes(&bytes, &parent)?;
  }

  if !node_bin.is_file() {
    return Err("Portable Node download succeeded but binary missing".to_string());
  }

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(&node_bin)
      .map_err(|e| e.to_string())?
      .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&node_bin, perms).map_err(|e| e.to_string())?;
  }

  emit_progress(app, "node", "ready", None);
  Ok(node_bin)
}

pub(crate) async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
  let client = reqwest::Client::builder()
    .user_agent("vixl-lsp-installer")
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .get(url)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("Download failed ({}) for {url}", response.status()));
  }
  response.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}