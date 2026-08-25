use std::collections::HashMap;

use super::rpc::{json_rpc, list_tools_internal};
use super::spawn::mcp_stop;
use super::types::{set_state, McpServerState, McpToolInfo, MCP_PROCESSES, MCP_STATES};

#[tauri::command]
pub async fn mcp_refresh(server_id: String) -> Result<McpServerState, String> {
    set_state(&server_id, "refreshing", None, vec![], None).await;

    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(&server_id).cloned()
    };

    let Some(process) = process else {
        return Err("Server not running".to_string());
    };

    let tools = list_tools_internal(&process).await?;
    set_state(&server_id, "connected", None, tools.clone(), None).await;

    let icons = {
        let states = MCP_STATES.lock().await;
        states.get(&server_id).and_then(|state| state.icons.clone())
    };

    Ok(McpServerState {
        server_id: server_id.clone(),
        status: "connected".to_string(),
        error: None,
        tools,
        icons,
    })
}

#[tauri::command]
pub async fn mcp_logout(server_id: String) -> Result<(), String> {
    mcp_stop(server_id.clone()).await?;
    set_state(&server_id, "auth_required", None, vec![], None).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools(server_id: String) -> Result<Vec<McpToolInfo>, String> {
    let state = mcp_status(server_id.clone()).await?;
    Ok(state.tools)
}

async fn sync_process_liveness(server_id: &str) -> Option<McpServerState> {
    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(server_id).cloned()
    };

    if let Some(process) = process {
        let is_running = {
            let mut guard = process.lock().await;
            matches!(guard.child.try_wait(), Ok(None))
        };

        if is_running {
            let states = MCP_STATES.lock().await;
            return states.get(server_id).cloned();
        }

        let mut processes = MCP_PROCESSES.lock().await;
        processes.remove(server_id);
        drop(processes);
        set_state(server_id, "stopped", None, vec![], None).await;
        let states = MCP_STATES.lock().await;
        return states.get(server_id).cloned();
    }

    let should_mark_stopped = {
        let states = MCP_STATES.lock().await;
        states.get(server_id).map(|state| {
            state.status == "connected"
                || state.status == "starting"
                || state.status == "refreshing"
        })
    };

    if should_mark_stopped == Some(true) {
        set_state(server_id, "stopped", None, vec![], None).await;
    }

    let states = MCP_STATES.lock().await;
    states.get(server_id).cloned()
}

#[tauri::command]
pub async fn mcp_status(server_id: String) -> Result<McpServerState, String> {
    if let Some(state) = sync_process_liveness(&server_id).await {
        return Ok(state);
    }
    Ok(McpServerState {
        server_id,
        status: "stopped".to_string(),
        error: None,
        tools: vec![],
        icons: None,
    })
}

#[tauri::command]
pub async fn mcp_list_statuses() -> Result<HashMap<String, McpServerState>, String> {
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

    let mut result = HashMap::new();
    for id in all_ids {
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
) -> Result<serde_json::Value, String> {
    let process = {
        let processes = MCP_PROCESSES.lock().await;
        processes.get(&server_id).cloned()
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
