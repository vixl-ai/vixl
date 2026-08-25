use std::path::Path;

/// Basenames allowed for MCP stdio servers (resolved via PATH). Absolute paths are rejected.
const ALLOWED_MCP_COMMANDS: &[&str] = &[
    "npx",
    "npm",
    "node",
    "pnpm",
    "yarn",
    "bun",
    "deno",
    "uvx",
    "uv",
    "python",
    "python3",
    "pipx",
    "codegraph",
];

pub fn validate_mcp_spawn(command: &str, args: &[String]) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("MCP command is required".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || Path::new(trimmed).components().count() != 1
    {
        return Err(
            "MCP command must be a PATH basename (for example npx or uvx), not a filesystem path"
                .to_string(),
        );
    }
    let lower = trimmed.to_ascii_lowercase();
    if !ALLOWED_MCP_COMMANDS.iter().any(|allowed| *allowed == lower) {
        return Err(format!(
            "MCP command '{trimmed}' is not allowed. Use one of: {}",
            ALLOWED_MCP_COMMANDS.join(", ")
        ));
    }
    for arg in args {
        if arg.contains('\0') {
            return Err("MCP args must not contain NUL bytes".to_string());
        }
    }
    Ok(())
}
