use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    pub project_slug: String,
    pub project_root: String,
    pub mode: String,
    pub model: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub forked_from: Option<String>,
    pub pinned: bool,
    pub pinned_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix_snapshot: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_context: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub awaiting_plan_go: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_totals: Option<serde_json::Value>,
}

pub struct ChatRecord {
    pub meta: ChatMeta,
    pub project_id: String,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
