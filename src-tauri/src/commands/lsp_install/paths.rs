use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use super::super::paths::user_vixl_dir;


pub fn lsp_root(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = user_vixl_dir(app)?.join("lsp");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

pub fn runtime_node_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = user_vixl_dir(app)?.join("runtime").join("node");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

pub fn managed_server_dir(app: &AppHandle, server_id: &str, version_key: &str) -> Result<PathBuf, String> {
  let dir = lsp_root(app)?.join(server_id).join(version_key);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

pub fn auto_download_enabled(app: &AppHandle) -> bool {
  if std::env::var("VIXL_DISABLE_LSP_DOWNLOAD")
    .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
    .unwrap_or(false)
  {
    return false;
  }

  let Ok(settings) = super::super::config::read_settings_for_lsp(app) else {
    return true;
  };
  settings
    .get("lsp.autoDownload")
    .and_then(|v| v.as_bool())
    .unwrap_or(true)
}