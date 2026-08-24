use std::path::Path;

pub fn codegraph_store_env_vars(
  canonical_root: &Path,
  store_dir: &Path,
  preload_path: &Path,
) -> Vec<(String, String)> {
  vec![
    (
      "VIXL_CODEGRAPH_PROJECT".to_string(),
      canonical_root.to_string_lossy().to_string(),
    ),
    (
      "VIXL_CODEGRAPH_STORE".to_string(),
      store_dir.to_string_lossy().to_string(),
    ),
    (
      "NODE_OPTIONS".to_string(),
      node_options_with_preload(preload_path),
    ),
  ]
}

pub fn node_options_with_preload(preload_path: &Path) -> String {
  let require_flag = format!("--require {}", quote_node_options_path(preload_path));
  match std::env::var("NODE_OPTIONS") {
    Ok(existing) if !existing.trim().is_empty() => {
      if existing.contains(&*preload_path.to_string_lossy()) {
        existing
      } else {
        format!("{} {require_flag}", existing.trim())
      }
    }
    _ => require_flag,
  }
}

fn quote_node_options_path(path: &Path) -> String {
  let raw = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
  format!("\"{raw}\"")
}
