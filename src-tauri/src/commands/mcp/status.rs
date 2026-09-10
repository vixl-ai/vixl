use std::collections::HashMap;

use super::rpc::{json_rpc, list_tools_internal};
use super::spawn::mcp_stop;
use super::types::{
    mcp_connection_key, set_state, McpServerState, McpToolInfo, MCP_PROCESSES, MCP_STATES,
};

fn resolved_scope_key(scope_key: Option<&str>) -> String {
    scope_key.unwrap_or("personal").to_string()
}

fn split_connection_key(connection_key: &str) -> (&str, &str) {
    connection_key
        .split_once('\u{1f}')
        .unwrap_or(("personal", connection_key))
}

#[tauri::command]
pub async fn mcp_refresh(
    server_id: String,
    scope_key: Option<String>,
) -> Result<McpServerState, String> {
    let connection_key = mcp_connection_key(scope_key.as_deref(), &server_id);
    set_state(
        scope_key.as_deref(),
        &server_id,
        "refreshing",
        None,
        vec![],
        None,
    )
    .await;

    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(&connection_key).cloned()
    };

    let Some(process) = process else {
        set_state(
            scope_key.as_deref(),
            &server_id,
            "stopped",
            Some("Server not running".to_string()),
            vec![],
            None,
        )
        .await;
        return Err("Server not running".to_string());
    };

    let tools = list_tools_internal(&process).await?;
    set_state(
        scope_key.as_deref(),
        &server_id,
        "connected",
        None,
        tools.clone(),
        None,
    )
    .await;

    let icons = {
        let states = MCP_STATES.lock().await;
        states
            .get(&connection_key)
            .and_then(|state| state.icons.clone())
    };

    Ok(McpServerState {
        server_id: server_id.clone(),
        scope_key: resolved_scope_key(scope_key.as_deref()),
        status: "connected".to_string(),
        error: None,
        tools,
        icons,
    })
}

#[tauri::command]
pub async fn mcp_logout(server_id: String, scope_key: Option<String>) -> Result<(), String> {
    mcp_stop(server_id.clone(), scope_key.clone()).await?;
    set_state(
        scope_key.as_deref(),
        &server_id,
        "auth_required",
        None,
        vec![],
        None,
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools(
    server_id: String,
    scope_key: Option<String>,
) -> Result<Vec<McpToolInfo>, String> {
    let state = mcp_status(server_id, scope_key).await?;
    Ok(state.tools)
}

async fn sync_process_liveness(connection_key: &str) -> Option<McpServerState> {
    let (scope, server_id) = split_connection_key(connection_key);
    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(connection_key).cloned()
    };

    if let Some(process) = process {
        let is_running = {
            let mut guard = process.lock().await;
            matches!(guard.child.try_wait(), Ok(None))
        };

        if is_running {
            let states = MCP_STATES.lock().await;
            return states.get(connection_key).cloned();
        }

        let mut processes = MCP_PROCESSES.lock().await;
        processes.remove(connection_key);
        drop(processes);
        set_state(Some(scope), server_id, "stopped", None, vec![], None).await;
        let states = MCP_STATES.lock().await;
        return states.get(connection_key).cloned();
    }

    let should_mark_stopped = {
        let states = MCP_STATES.lock().await;
        states.get(connection_key).map(|state| {
            state.status == "connected"
                || state.status == "starting"
                || state.status == "refreshing"
        })
    };

    if should_mark_stopped == Some(true) {
        set_state(Some(scope), server_id, "stopped", None, vec![], None).await;
    }

    let states = MCP_STATES.lock().await;
    states.get(connection_key).cloned()
}

#[tauri::command]
pub async fn mcp_status(
    server_id: String,
    scope_key: Option<String>,
) -> Result<McpServerState, String> {
    let connection_key = mcp_connection_key(scope_key.as_deref(), &server_id);
    if let Some(state) = sync_process_liveness(&connection_key).await {
        return Ok(state);
    }
    Ok(McpServerState {
        server_id,
        scope_key: resolved_scope_key(scope_key.as_deref()),
        status: "stopped".to_string(),
        error: None,
        tools: vec![],
        icons: None,
    })
}

#[tauri::command]
pub async fn mcp_list_statuses(
    scope_key: Option<String>,
) -> Result<HashMap<String, McpServerState>, String> {
    let state_ids: Vec<String> = {
        let states = MCP_STATES.lock().await;
        states.keys().cloned().collect()
    };
    let process_ids: Vec<String> = {
        let processes = MCP_PROCESSES.lock().await;
        processes.keys().cloned().collect()
    };

    let mut all_ids: std::collections::HashSet<String> = state_ids.into_iter().collect();
    all_ids.extend(process_ids);

    let prefix = format!("{}\u{1f}", resolved_scope_key(scope_key.as_deref()));

    let mut result = HashMap::new();
    for id in all_ids {
        if !id.starts_with(&prefix) {
            continue;
        }
        if let Some(state) = sync_process_liveness(&id).await {
            result.insert(id, state);
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool: String,
    args: serde_json::Value,
    scope_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let connection_key = mcp_connection_key(scope_key.as_deref(), &server_id);
    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(&connection_key).cloned()
    };

    let Some(process) = process else {
        return Err("Server not running".to_string());
    };

    let response = json_rpc(
        &process,
        "tools/call",
        serde_json::json!({
          "name": tool,
          "arguments": args,
        }),
    )
    .await?;

    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("tools/call failed")
            .to_string();
        return Err(message);
    }

    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}
