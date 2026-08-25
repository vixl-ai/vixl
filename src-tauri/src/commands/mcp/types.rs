use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpIcon {
    pub src: String,
    pub mime_type: Option<String>,
    pub sizes: Option<Vec<String>>,
    pub theme: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerState {
    pub server_id: String,
    pub status: String,
    pub error: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub icons: Option<Vec<McpIcon>>,
}

pub(crate) struct McpProcess {
    pub(crate) child: tokio::process::Child,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    pub(crate) next_id: Mutex<u64>,
}

lazy_static::lazy_static! {
  pub(crate) static ref MCP_PROCESSES: Mutex<HashMap<String, std::sync::Arc<Mutex<McpProcess>>>> =
    Mutex::new(HashMap::new());
  pub(crate) static ref MCP_STATES: Mutex<HashMap<String, McpServerState>> = Mutex::new(HashMap::new());
}

pub(crate) fn parse_mcp_icons(value: Option<&serde_json::Value>) -> Option<Vec<McpIcon>> {
    let icons = value?.as_array()?;
    let parsed: Vec<McpIcon> = icons
        .iter()
        .filter_map(|icon| {
            let src = icon.get("src")?.as_str()?.to_string();
            if src.is_empty() {
                return None;
            }
            Some(McpIcon {
                src,
                mime_type: icon
                    .get("mimeType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                sizes: icon.get("sizes").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                }),
                theme: icon
                    .get("theme")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
        })
        .collect();
    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

pub(crate) async fn set_state(
    server_id: &str,
    status: &str,
    error: Option<String>,
    tools: Vec<McpToolInfo>,
    icons: Option<Vec<McpIcon>>,
) {
    let mut states = MCP_STATES.lock().await;
    let previous_icons = states.get(server_id).and_then(|state| state.icons.clone());
    states.insert(
        server_id.to_string(),
        McpServerState {
            server_id: server_id.to_string(),
            status: status.to_string(),
            error,
            tools,
            icons: icons.or(previous_icons),
        },
    );
}
