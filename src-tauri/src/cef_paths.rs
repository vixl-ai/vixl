//! Resolve CEF framework / DLL root and helper binary paths.
//!
//! Order: `CEF_PATH` env, bundled app locations, then the export-cef-dir
//! default (`~/.local/share/cef`). Shared by the main app and
//! `vixl_cef_helper` (via `#[path]` include) so both stay in sync.

use std::path::{Path, PathBuf};

/// macOS framework directory name shipped by CEF.
pub const MACOS_FRAMEWORK_NAME: &str = "Chromium Embedded Framework.framework";
/// Binary inside the macOS framework bundle.
pub const MACOS_FRAMEWORK_BINARY: &str = "Chromium Embedded Framework";
/// Helper executable name (Tauri externalBin / cargo bin).
pub const HELPER_NAME: &str = "vixl_cef_helper";
/// Nested helper app name under Contents/Frameworks (macOS packaged).
pub const BUNDLED_HELPER_APP_NAME: &str = "vixl Helper.app";
/// Executable file name inside the nested helper app (macOS packaged).
pub const BUNDLED_HELPER_EXE_NAME: &str = "vixl Helper";

#[derive(Clone, Debug)]
pub struct CefPaths {
  /// Directory that contains the platform CEF binaries (framework parent,
  /// or the flat DLL / .so directory on Windows / Linux).
  pub root: PathBuf,
  /// Absolute path to the helper subprocess binary.
  pub helper: PathBuf,
}

impl CefPaths {
  #[cfg(target_os = "macos")]
  pub fn framework_dir(&self) -> PathBuf {
    if self.root.file_name().and_then(|n| n.to_str()) == Some(MACOS_FRAMEWORK_NAME) {
      self.root.clone()
    } else {
      self.root.join(MACOS_FRAMEWORK_NAME)
    }
  }

  #[cfg(target_os = "macos")]
  pub fn framework_binary(&self) -> PathBuf {
    self.framework_dir().join(MACOS_FRAMEWORK_BINARY)
  }
}

/// Resolve CEF paths for the current process.
///
/// `resource_dir` is Tauri's resource directory when available (bundled
/// Linux / Windows layouts). On macOS the framework lives under
/// `Contents/Frameworks/`, not Resources.
pub fn resolve(resource_dir: Option<&Path>) -> Result<CefPaths, String> {
  let root = resolve_root(resource_dir)?;
  let helper = resolve_helper()?;
  Ok(CefPaths { root, helper })
}

fn resolve_root(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
  if let Ok(path) = std::env::var("CEF_PATH") {
    let path = PathBuf::from(path);
    if path.as_os_str().is_empty() {
      return Err("CEF_PATH is set but empty".into());
    }
    return Ok(path);
  }

  #[cfg(target_os = "macos")]
  if let Some(framework) = bundled_macos_framework_dir() {
    // Parent of the .framework is the historical CEF_PATH layout; keep
    // root as the Frameworks directory so framework_dir() joins the name.
    if let Some(parent) = framework.parent() {
      return Ok(parent.to_path_buf());
    }
  }

  if let Some(dir) = resource_dir {
    if resource_dir_looks_like_cef(dir) {
      return Ok(dir.to_path_buf());
    }
  }

  if let Some(dir) = beside_exe_cef_root() {
    return Ok(dir);
  }

  Ok(dev_default_cef_root())
}

fn exe_file_stem(exe: &Path) -> &str {
  let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or("");
  name.strip_suffix(".exe").unwrap_or(name)
}

fn current_exe_is_helper(exe: &Path) -> bool {
  let stem = exe_file_stem(exe);
  stem == HELPER_NAME || stem.starts_with(BUNDLED_HELPER_EXE_NAME)
}

fn resolve_helper() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  if current_exe_is_helper(&exe) {
    return Ok(exe);
  }

  #[cfg(target_os = "macos")]
  if let Some(helper) = bundled_macos_helper_exe(&exe) {
    return Ok(helper);
  }

  let dir = exe
    .parent()
    .ok_or_else(|| "current exe has no parent".to_string())?;

  let candidates = [
    dir.join(HELPER_NAME),
    #[cfg(windows)]
    dir.join(format!("{HELPER_NAME}.exe")),
  ];

  for candidate in &candidates {
    if candidate.exists() {
      return Ok(candidate.clone());
    }
  }

  // Dev: cargo places bins next to each other under target/{debug,release}.
  Err(format!(
    "CEF helper missing next to {} (expected {HELPER_NAME} or nested {BUNDLED_HELPER_APP_NAME}; build with --features cef)",
    exe.display()
  ))
}

#[cfg(target_os = "macos")]
fn bundled_macos_helper_exe(main_exe: &Path) -> Option<PathBuf> {
  // App.app/Contents/MacOS/<bin> -> Frameworks/vixl Helper.app/Contents/MacOS/vixl Helper
  let contents = main_exe.parent()?.parent()?;
  let helper = contents
    .join("Frameworks")
    .join(BUNDLED_HELPER_APP_NAME)
    .join("Contents")
    .join("MacOS")
    .join(BUNDLED_HELPER_EXE_NAME);
  helper.is_file().then_some(helper)
}

#[cfg(target_os = "macos")]
fn bundled_macos_framework_dir() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  macos_framework_dir_from_exe(&exe)
}

/// Framework from the main exe (`.../Contents/Frameworks/CEF.framework`) or a
/// nested helper (`.../Frameworks/vixl Helper.app/Contents/MacOS/...`).
#[cfg(target_os = "macos")]
fn macos_framework_dir_from_exe(exe: &Path) -> Option<PathBuf> {
  for ancestor in exe.ancestors() {
    let framework = ancestor.join("Frameworks").join(MACOS_FRAMEWORK_NAME);
    if framework.is_dir() {
      return Some(framework);
    }
  }
  None
}

fn resource_dir_looks_like_cef(dir: &Path) -> bool {
  #[cfg(target_os = "macos")]
  {
    if dir.join(MACOS_FRAMEWORK_NAME).is_dir() {
      return true;
    }
  }
  #[cfg(windows)]
  {
    if dir.join("libcef.dll").is_file() {
      return true;
    }
  }
  #[cfg(target_os = "linux")]
  {
    if dir.join("libcef.so").is_file() {
      return true;
    }
  }
  let _ = dir;
  false
}

fn beside_exe_cef_root() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let dir = exe.parent()?.to_path_buf();
  if resource_dir_looks_like_cef(&dir) {
    return Some(dir);
  }
  None
}

fn dev_default_cef_root() -> PathBuf {
  #[cfg(windows)]
  {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    return PathBuf::from(home).join(".local").join("share").join("cef");
  }
  #[cfg(not(windows))]
  {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".local/share/cef")
  }
}

/// True when the process appears to run from a macOS .app bundle.
#[cfg(target_os = "macos")]
pub fn running_inside_app_bundle() -> bool {
  bundled_macos_framework_dir().is_some()
    || std::env::current_exe()
      .ok()
      .and_then(|exe| {
        let macos = exe.parent()?;
        let contents = macos.parent()?;
        Some(contents.join("Info.plist").is_file())
      })
      .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
pub fn running_inside_app_bundle() -> bool {
  false
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn helper_self_names() {
    assert!(current_exe_is_helper(Path::new("vixl_cef_helper")));
    assert!(current_exe_is_helper(Path::new("vixl Helper")));
    assert!(current_exe_is_helper(Path::new(
      "vixl Helper (Renderer)"
    )));
    assert!(!current_exe_is_helper(Path::new("not-the-helper")));
  }
}
