use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::AppHandle;
use tokio::process::Command;

use super::env::codegraph_store_env_vars;
use super::prepare::prepare_codegraph_store;
use super::safety_net::safety_net_after_cli;
use crate::commands::fs::canonical_project_root;
use crate::commands::mcp::{apply_resolved_path_env, resolve_command};

const CODEGRAPH_NPM_PACKAGE: &str = "@colbymchenry/codegraph";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodegraphCliResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

pub fn validate_action(action: &str) -> Result<&'static str, String> {
    match action.trim().to_ascii_lowercase().as_str() {
        "init" => Ok("init"),
        "index" => Ok("index"),
        other => Err(format!(
            "Unsupported codegraph action '{other}'. Allowed: init, index"
        )),
    }
}

pub fn validate_absolute_root(project_root: &str) -> Result<PathBuf, String> {
    let trimmed = project_root.trim();
    if trimmed.is_empty() {
        return Err("project_root is required".to_string());
    }
    if trimmed.contains('\0') {
        return Err("project_root must not contain NUL bytes".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err("project_root must be an absolute path".to_string());
    }
    canonical_project_root(trimmed)
}

/// Runs an allowlisted CodeGraph CLI action via `npx -y @colbymchenry/codegraph`.
/// Supported: `init` (first index) and `index` (rebuild / force reindex).
#[tauri::command]
pub async fn codegraph_cli(
    app: AppHandle,
    project_root: String,
    action: String,
) -> Result<CodegraphCliResult, String> {
    let cli_action = validate_action(&action)?;
    let root = validate_absolute_root(&project_root)?;
    let root_str = root.to_string_lossy().to_string();
    let prepared = prepare_codegraph_store(&app, &root)?;

    let mut args = vec!["-y", CODEGRAPH_NPM_PACKAGE, cli_action];
    if cli_action == "index" {
        args.push("--force");
    }
    args.push(&root_str);

    let npx = resolve_command(&app, "npx").await?;
    let mut command = Command::new(&npx);
    command
        .args(&args)
        .current_dir(&root)
        .env("CODEGRAPH_TELEMETRY", "0")
        .env("CODEGRAPH_NO_UPDATE_CHECK", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (key, value) in codegraph_store_env_vars(&root, &prepared.graph_dir, &prepared.preload_path)
    {
        command.env(key, value);
    }
    apply_resolved_path_env(&mut command, &npx);

    let output = command
        .output()
        .await
        .map_err(|error| format!("Failed to run codegraph {cli_action}: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();
    let ok = output.status.success();

    if !ok {
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!(
                "codegraph {cli_action} exited with code {}",
                exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            )
        };
        return Err(detail);
    }

    safety_net_after_cli(&root, &prepared.graph_dir)?;

    Ok(CodegraphCliResult {
        ok,
        stdout,
        stderr,
        exit_code,
    })
}
