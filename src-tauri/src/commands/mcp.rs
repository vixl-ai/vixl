mod allowlist;
mod env;
#[path = "mcp/resolve-command.rs"]
mod resolve_cmd;
mod rpc;
mod spawn;
mod status;
mod types;

pub use allowlist::validate_mcp_spawn;
pub use env::validate_mcp_env;
pub(crate) use resolve_cmd::apply_resolved_path_env;
pub use resolve_cmd::resolve_command;
pub use spawn::{mcp_start, mcp_stop};
pub use status::{
    mcp_call_tool, mcp_list_statuses, mcp_list_tools, mcp_logout, mcp_refresh, mcp_status,
};
pub use types::{McpIcon, McpServerState, McpToolInfo};
