use std::collections::HashMap;

use app_lib::commands::mcp::{validate_mcp_env, validate_mcp_spawn};

#[test]
fn mcp_command_allowlist() {
    assert!(validate_mcp_spawn("npx", &[]).is_ok());
    assert!(validate_mcp_spawn("uvx", &["some-server".into()]).is_ok());
    assert!(validate_mcp_spawn("codegraph", &["serve".into(), "--mcp".into()]).is_ok());
    assert!(validate_mcp_spawn("CODEGRAPH", &["serve".into(), "--mcp".into()]).is_ok());
    assert!(validate_mcp_spawn("/usr/bin/npx", &[]).is_err());
    assert!(validate_mcp_spawn("/usr/local/bin/codegraph", &[]).is_err());
    assert!(validate_mcp_spawn("bash", &["-c".into(), "id".into()]).is_err());
    assert!(validate_mcp_spawn("npx", &["ok\0evil".into()]).is_err());
}

#[test]
fn mcp_env_overlay_allows_codegraph_keys() {
    let mut env = HashMap::new();
    env.insert("CODEGRAPH_MCP_TOOLS".into(), "explore,node".into());
    env.insert("CODEGRAPH_TELEMETRY".into(), "0".into());
    assert!(validate_mcp_env(&env).is_ok());
}

#[test]
fn mcp_env_overlay_denies_dangerous_keys() {
    let mut env = HashMap::new();
    env.insert("PATH".into(), "/evil".into());
    assert!(validate_mcp_env(&env).is_err());
}

#[test]
fn mcp_env_overlay_denies_node_options() {
    // Overlay must not set NODE_OPTIONS. Rust injects it for CodeGraph children
    // after validation, appending --require for the store preload.
    let mut env = HashMap::new();
    env.insert("NODE_OPTIONS".into(), "--require /tmp/evil.js".into());
    assert!(validate_mcp_env(&env).is_err());
}
