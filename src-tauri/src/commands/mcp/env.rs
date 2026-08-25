use std::collections::HashMap;

fn is_dangerous_mcp_env_key(key: &str) -> bool {
    let upper = key.trim().to_ascii_uppercase();
    if upper.is_empty() {
        return true;
    }
    if upper.starts_with("DYLD_") || upper.starts_with("LD_") {
        return true;
    }
    matches!(
        upper.as_str(),
        "PATH"
            | "PATHEXT"
            | "LD_PRELOAD"
            | "LD_LIBRARY_PATH"
            | "LD_AUDIT"
            | "DYLD_INSERT_LIBRARIES"
            | "DYLD_LIBRARY_PATH"
            | "DYLD_FRAMEWORK_PATH"
            | "DYLD_FALLBACK_LIBRARY_PATH"
            | "DYLD_FORCE_FLAT_NAMESPACE"
            | "OPENSSL_CONF"
            | "PYTHONPATH"
            | "PYTHONHOME"
            | "NODE_OPTIONS"
            | "NODE_PATH"
            | "BASH_ENV"
            | "ENV"
            | "SHELLOPTS"
            | "IFS"
            | "CDPATH"
            | "PROMPT_COMMAND"
            | "PERL5LIB"
            | "PERL5OPT"
            | "RUBYOPT"
            | "RUBYLIB"
    )
}

pub fn validate_mcp_env(env: &HashMap<String, String>) -> Result<(), String> {
    for (key, value) in env {
        if is_dangerous_mcp_env_key(key) {
            return Err(format!("MCP env key '{key}' is not allowed"));
        }
        if key.contains('\0') || value.contains('\0') {
            return Err("MCP env must not contain NUL bytes".to_string());
        }
    }
    Ok(())
}
