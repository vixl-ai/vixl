use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::super::paths::user_vixl_dir;

fn canonicalize_root(path: PathBuf) -> PathBuf {
  path.canonicalize().unwrap_or(path)
}

fn vixl_temp_dir() -> PathBuf {
  canonicalize_root(std::env::temp_dir().join("vixl"))
}

/// True when `canonical` is under HOME, the user vixl dir, or `temp_dir/vixl`.
pub fn is_reveal_path_allowed(canonical: &Path, home: Option<&Path>, user_vixl: &Path) -> bool {
  let under_home = home.is_some_and(|home_path| canonical.starts_with(home_path));
  let under_vixl = canonical.starts_with(user_vixl);
  let under_temp = canonical.starts_with(vixl_temp_dir());
  under_home || under_vixl || under_temp
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
  let canonical = PathBuf::from(&path)
    .canonicalize()
    .map_err(|error| format!("Path does not exist or cannot be resolved: {error}"))?;

  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .ok()
    .map(PathBuf::from)
    .map(canonicalize_root);

  let user_vixl = canonicalize_root(user_vixl_dir(&app)?);

  if !is_reveal_path_allowed(&canonical, home.as_deref(), &user_vixl) {
    return Err("Path is outside allowed directories".to_string());
  }

  open::that_detached(canonical).map_err(|e| e.to_string())
}
