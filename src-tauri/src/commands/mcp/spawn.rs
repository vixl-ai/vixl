use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::allowlist::validate_mcp_spawn;
use super::env::validate_mcp_env;
use super::resolve_cmd::{apply_resolved_path_env, resolve_command};
use super::rpc::{json_rpc, json_rpc_notify, list_tools_internal, spawn_reader};
use super::types::{
  parse_mcp_icons, set_state, McpProcess, McpServerState, MCP_PROCESSES,
};
use crate::commands::codegraph::{codegraph_store_env_vars, prepare_codegraph_store};
use crate::commands::fs::canonical_project_root;

#[tauri::command]
pub async fn mcp_start(
  app: AppHandle,
  server_id: String,
  command: String,
  args: Vec<String>,
  env: Option<HashMap<String, String>>,
) -> Result<McpServerState, String> {
  validate_mcp_spawn(&command, &args)?;
  let env_overlay = env.unwrap_or_default();
  validate_mcp_env(&env_overlay)?;
  let program = resolve_command(&app, command.trim()).await?;
  mcp_stop(server_id.clone()).await.ok();

  let codegraph_path = if server_id == "codegraph" {
    extract_codegraph_project_path(&args)
  } else {
    None
  };
  let mut codegraph_store_dir: Option<PathBuf> = None;
  let mut codegraph_env: Vec<(String, String)> = Vec::new();
  if let Some(project_path) = codegraph_path.as_deref() {
    let canonical = canonical_project_root(project_path)?;
    let prepared = prepare_codegraph_store(&app, &canonical)?;
    codegraph_env = codegraph_store_env_vars(
      &canonical,
      &prepared.graph_dir,
      &prepared.preload_path,
    );
    kill_orphaned_codegraph(project_path, Some(&prepared.graph_dir)).await;
    codegraph_store_dir = Some(prepared.graph_dir);
  }

  set_state(&server_id, "starting", None, vec![], None).await;

  let mut command_builder = Command::new(&program);
  command_builder
    .args(&args)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
  #[cfg(unix)]
  {
    command_builder.process_group(0);
  }
  for (key, value) in &env_overlay {
    command_builder.env(key, value);
  }
  for (key, value) in &codegraph_env {
    command_builder.env(key, value);
  }
  apply_resolved_path_env(&mut command_builder, &program);

  let mut child = command_builder.spawn().map_err(|e| {
    let message = format!("Failed to spawn MCP command '{command}': {e}");
    message
  })?;

  // Drain stderr so the child cannot block on a full pipe; keep a short tail for errors.
  let stderr = child.stderr.take();
  let stderr_tail = std::sync::Arc::new(Mutex::new(String::new()));
  if let Some(stderr) = stderr {
    let stderr_tail = stderr_tail.clone();
    tokio::spawn(async move {
      let mut lines = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        let mut guard = stderr_tail.lock().await;
        if guard.len() < 4_000 {
          if !guard.is_empty() {
            guard.push('\n');
          }
          guard.push_str(&line);
        }
      }
    });
  }

  let process = std::sync::Arc::new(Mutex::new(McpProcess {
    child,
    pending: Mutex::new(HashMap::new()),
    next_id: Mutex::new(0),
  }));

  spawn_reader(process.clone(), server_id.clone());

  {
    let mut processes = MCP_PROCESSES.lock().await;
    processes.insert(server_id.clone(), process.clone());
  }

  let fail = |message: String| async {
    let stderr_text = stderr_tail.lock().await.clone();
    let full = if stderr_text.trim().is_empty() {
      message
    } else {
      format!("{message}\n{stderr_text}")
    };
    let _ = mcp_stop(server_id.clone()).await;
    if let Some(project_path) = codegraph_path.as_deref() {
      kill_orphaned_codegraph(project_path, codegraph_store_dir.as_deref()).await;
    }
    set_state(&server_id, "error", Some(full.clone()), vec![], None).await;
    Err(full)
  };

  let init = match json_rpc(
    &process,
    "initialize",
    serde_json::json!({
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "vixl", "version": "0.1.0" }
    }),
  )
  .await
  {
    Ok(value) => value,
    Err(message) => return fail(message).await,
  };

  if init.get("error").is_some() {
    let message = init
      .get("error")
      .and_then(|e| e.get("message"))
      .and_then(|m| m.as_str())
      .unwrap_or("initialize failed")
      .to_string();
    return fail(message).await;
  }

  if let Err(message) = json_rpc_notify(
    &process,
    "notifications/initialized",
    serde_json::json!({}),
  )
  .await
  {
    return fail(message).await;
  }

  let icons = parse_mcp_icons(
    init
      .get("result")
      .and_then(|result| result.get("serverInfo"))
      .and_then(|info| info.get("icons")),
  );
  let tools = match list_tools_internal(&process).await {
    Ok(tools) => tools,
    Err(message) => return fail(message).await,
  };
  set_state(
    &server_id,
    "connected",
    None,
    tools.clone(),
    icons.clone(),
  )
  .await;

  Ok(McpServerState {
    server_id,
    status: "connected".to_string(),
    error: None,
    tools,
    icons,
  })
}

fn extract_codegraph_project_path(args: &[String]) -> Option<String> {
  let mut saw_path_flag = false;
  for arg in args {
    if saw_path_flag {
      let trimmed = arg.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
      return None;
    }
    if arg == "--path" {
      saw_path_flag = true;
    }
  }
  None
}

/// Best-effort cleanup of orphaned CodeGraph MCP trees left behind when `npx`
/// reparents children out of the process group we track.
async fn kill_orphaned_codegraph(project_path: &str, store_dir: Option<&Path>) {
  let path = project_path.trim();
  if path.is_empty() {
    return;
  }
  #[cfg(unix)]
  {
    let patterns = [
      format!("codegraph.js serve --mcp --path {path}"),
      format!("codegraph serve --mcp --path {path}"),
      format!("@colbymchenry/codegraph serve --mcp --path {path}"),
    ];
    for pattern in patterns {
      let _ = Command::new("pkill")
        .args(["-f", &pattern])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
    }
  }
  if let Some(daemon_dir) = store_dir {
    let _ = tokio::fs::remove_file(daemon_dir.join("daemon.sock")).await;
    let _ = tokio::fs::remove_file(daemon_dir.join("daemon.pid")).await;
  }
}

#[tauri::command]
pub async fn mcp_stop(server_id: String) -> Result<(), String> {
  let process = {
    let mut processes = MCP_PROCESSES.lock().await;
    processes.remove(&server_id)
  };

  if let Some(process) = process {
    let mut guard = process.lock().await;
    #[cfg(unix)]
    {
      if let Some(pid) = guard.child.id() {
        let pgid = pid as i32;
        unsafe {
          let _ = libc::killpg(pgid, libc::SIGTERM);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        unsafe {
          let _ = libc::killpg(pgid, libc::SIGKILL);
        }
      }
    }
    let _ = guard.child.kill().await;
    let _ = guard.child.wait().await;
  }

  set_state(&server_id, "stopped", None, vec![], None).await;
  Ok(())
}
