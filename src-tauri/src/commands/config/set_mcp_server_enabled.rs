use std::fs;
use std::path::Path;

use tauri::AppHandle;

use super::json_patch::patch_server_enabled;
use super::set_scoped_mcp_server_enabled;
use super::write_json::write_atomic;
use crate::commands::paths::user_vixl_dir;

pub fn apply_mcp_server_enabled(
    raw: &str,
    server_id: &str,
    enabled: bool,
) -> Result<Option<String>, String> {
    let parsed: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let servers = parsed
        .get("servers")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "mcp.json is missing a servers object".to_string())?;
    let server = servers
        .get(server_id)
        .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
    if !server.is_object() {
        return Err(format!("MCP server is not an object: {server_id}"));
    }
    let currently_enabled = server.get("enabled").and_then(|value| value.as_bool()) != Some(false);
    if currently_enabled == enabled {
        return Ok(None);
    }
    Ok(Some(patch_server_enabled(raw, server_id, enabled)?))
}

pub fn set_mcp_server_enabled_at_path(
    path: &Path,
    server_id: &str,
    enabled: bool,
) -> Result<bool, String> {
    if !path.exists() {
        return Err("mcp.json does not exist".to_string());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    match apply_mcp_server_enabled(&raw, server_id, enabled)? {
        None => Ok(false),
        Some(patched) => {
            write_atomic(path, &patched)?;
            Ok(true)
        }
    }
}

#[tauri::command]
pub fn set_mcp_server_enabled(
    app: AppHandle,
    scope: String,
    root_path: Option<String>,
    server_id: String,
    enabled: bool,
) -> Result<bool, String> {
    set_scoped_mcp_server_enabled(&scope, root_path.as_deref(), &server_id, enabled, || {
        user_vixl_dir(&app)
    })
}
