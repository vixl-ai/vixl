use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};

use super::types::{set_state, McpProcess, McpToolInfo, MCP_PROCESSES};

const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

pub(crate) async fn json_rpc(
    process: &Mutex<McpProcess>,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = {
        let guard = process.lock().await;
        let mut next = guard.next_id.lock().await;
        *next += 1;
        *next
    };

    let (tx, rx) = oneshot::channel();
    {
        let guard = process.lock().await;
        guard.pending.lock().await.insert(id, tx);
    }

    let request = serde_json::json!({
      "jsonrpc": "2.0",
      "id": id,
      "method": method,
      "params": params,
    });

    let line = format!("{}\n", request);
    {
        let mut guard = process.lock().await;
        if let Some(stdin) = guard.child.stdin.as_mut() {
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
        } else {
            return Err("MCP process stdin unavailable".to_string());
        }
    }

    match tokio::time::timeout(MCP_REQUEST_TIMEOUT, rx).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err("MCP request cancelled".to_string()),
        Err(_) => {
            let guard = process.lock().await;
            guard.pending.lock().await.remove(&id);
            Err(format!(
                "MCP request timed out after {}s ({method})",
                MCP_REQUEST_TIMEOUT.as_secs()
            ))
        }
    }
}

pub(crate) async fn json_rpc_notify(
    process: &Mutex<McpProcess>,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let request = serde_json::json!({
      "jsonrpc": "2.0",
      "method": method,
      "params": params,
    });
    let line = format!("{}\n", request);
    let mut guard = process.lock().await;
    if let Some(stdin) = guard.child.stdin.as_mut() {
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("MCP process stdin unavailable".to_string())
    }
}

fn response_id_as_u64(value: &serde_json::Value) -> Option<u64> {
    let id = value.get("id")?;
    if let Some(n) = id.as_u64() {
        return Some(n);
    }
    if let Some(n) = id.as_i64() {
        return u64::try_from(n).ok();
    }
    if let Some(s) = id.as_str() {
        return s.parse::<u64>().ok();
    }
    None
}

pub(crate) fn spawn_reader(process: std::sync::Arc<Mutex<McpProcess>>, server_id: String) {
    tokio::spawn(async move {
        let stdout = {
            let mut guard = process.lock().await;
            guard.child.stdout.take()
        };

        let Some(stdout) = stdout else {
            return;
        };

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if let Some(id) = response_id_as_u64(&value) {
                let sender = {
                    let guard = process.lock().await;
                    let mut pending = guard.pending.lock().await;
                    pending.remove(&id)
                };
                if let Some(sender) = sender {
                    let _ = sender.send(value);
                }
            }
        }
        set_state(&server_id, "stopped", None, vec![], None).await;
        let mut processes = MCP_PROCESSES.lock().await;
        processes.remove(&server_id);
    });
}

pub(crate) async fn list_tools_internal(
    process: &Mutex<McpProcess>,
) -> Result<Vec<McpToolInfo>, String> {
    let response = json_rpc(process, "tools/list", serde_json::json!({})).await?;
    let tools = response
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(tools
        .into_iter()
        .filter_map(|tool| {
            Some(McpToolInfo {
                name: tool.get("name")?.as_str()?.to_string(),
                description: tool
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string()),
                input_schema: tool.get("inputSchema").cloned(),
                meta: tool.get("_meta").cloned(),
            })
        })
        .collect())
}
