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
    pub scope_key: String,
    pub status: String,
    pub error: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub icons: Option<Vec<McpIcon>>,
}

pub(crate) fn mcp_connection_key(scope_key: Option<&str>, server_id: &str) -> String {
    let scope = scope_key.unwrap_or("personal");
    format!("{scope}\u{1f}{server_id}")
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
    scope_key: Option<&str>,
    server_id: &str,
    status: &str,
    error: Option<String>,
    tools: Vec<McpToolInfo>,
    icons: Option<Vec<McpIcon>>,
) {
    let resolved_scope = scope_key.unwrap_or("personal");
    let connection_key = mcp_connection_key(scope_key, server_id);
    let mut states = MCP_STATES.lock().await;
    let previous_icons = states
        .get(&connection_key)
        .and_then(|state| state.icons.clone());
    states.insert(
        connection_key,
        McpServerState {
            server_id: server_id.to_string(),
            scope_key: resolved_scope.to_string(),
            status: status.to_string(),
            error,
            tools,
            icons: icons.or(previous_icons),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::mcp_connection_key;

    #[test]
    fn connection_key_defaults_none_to_personal() {
        assert_eq!(mcp_connection_key(None, "brave"), "personal\u{1f}brave");
    }

    #[test]
    fn connection_key_uses_project_root() {
        assert_eq!(
            mcp_connection_key(Some("/Users/aidan/proj"), "brave"),
            "/Users/aidan/proj\u{1f}brave"
        );
    }
}
