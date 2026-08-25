use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSessionTab {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub tab_type: String,
    pub label: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSession {
    pub tabs: Vec<WorkbenchSessionTab>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_sidebar_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchTabInput {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub tab_type: String,
    pub label: String,
    pub payload: serde_json::Value,
}
