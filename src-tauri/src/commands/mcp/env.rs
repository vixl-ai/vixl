use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::commands::fs::resolve_workspace_path;

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

#[tauri::command]
pub fn get_env_vars(names: Vec<String>) -> Result<HashMap<String, String>, String> {
    let mut values = HashMap::new();
    for name in names {
        let key = name.trim();
        if key.is_empty() || key.contains('\0') {
            continue;
        }
        if let Ok(value) = std::env::var(key) {
            values.insert(key.to_string(), value);
        }
    }
    Ok(values)
}

pub fn merge_mcp_env_file(
    env_file: Option<&str>,
    scope_key: Option<&str>,
    personal_dir: &Path,
    overlay: HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    let mut merged = match env_file {
        Some(path) => load_mcp_env_file(path, scope_key, personal_dir)?,
        None => HashMap::new(),
    };
    for (key, value) in overlay {
        merged.insert(key, value);
    }
    Ok(merged)
}

fn load_mcp_env_file(
    env_file: &str,
    scope_key: Option<&str>,
    personal_dir: &Path,
) -> Result<HashMap<String, String>, String> {
    let path = resolve_mcp_env_file_path(env_file, scope_key, personal_dir)?;
    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read MCP envFile '{}': {error}", path.display()))?;
    parse_dotenv(&contents)
        .map_err(|error| format!("Failed to parse MCP envFile '{}': {error}", path.display()))
}

fn resolve_mcp_env_file_path(
    env_file: &str,
    scope_key: Option<&str>,
    personal_dir: &Path,
) -> Result<PathBuf, String> {
    let trimmed = env_file.trim();
    if trimmed.is_empty() {
        return Err("MCP envFile is empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("MCP envFile must not contain NUL bytes".to_string());
    }

    let path = Path::new(trimmed);
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else if let Some(root) = project_root_from_scope(scope_key) {
        resolve_workspace_path(root, trimmed)?
    } else {
        personal_dir.join(trimmed)
    };

    if !resolved.exists() {
        return Err(format!("MCP envFile not found: {}", resolved.display()));
    }
    if !resolved.is_file() {
        return Err(format!("MCP envFile is not a file: {}", resolved.display()));
    }
    Ok(resolved)
}

pub(crate) fn project_root_from_scope(scope_key: Option<&str>) -> Option<&str> {
    let scope = scope_key?.trim();
    if scope.is_empty() || scope == "personal" {
        return None;
    }
    Some(scope)
}

fn parse_dotenv(contents: &str) -> Result<HashMap<String, String>, String> {
    let text = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    let mut map = HashMap::new();
    for (index, raw_line) in text.lines().enumerate() {
        let line_no = index + 1;
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = match line.strip_prefix("export ") {
            Some(rest) => rest.trim(),
            None => line,
        };
        let Some((key, rest)) = line.split_once('=') else {
            return Err(format!("invalid line {line_no}: missing '='"));
        };
        let key = key.trim();
        if !is_valid_dotenv_key(key) {
            return Err(format!("invalid line {line_no}: bad variable name"));
        }
        let value = parse_dotenv_value(rest, line_no)?;
        map.insert(key.to_string(), value);
    }
    Ok(map)
}

fn is_valid_dotenv_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn parse_dotenv_value(raw: &str, line_no: usize) -> Result<String, String> {
    let trimmed = raw.trim();
    if let Some(inner) = trimmed.strip_prefix('"') {
        let Some(unquoted) = inner.strip_suffix('"') else {
            return Err(format!("invalid line {line_no}: unterminated double quote"));
        };
        return Ok(unescape_double_quoted(unquoted));
    }
    if let Some(inner) = trimmed.strip_prefix('\'') {
        let Some(unquoted) = inner.strip_suffix('\'') else {
            return Err(format!("invalid line {line_no}: unterminated single quote"));
        };
        return Ok(unquoted.to_string());
    }
    let without_comment = match trimmed.find(" #") {
        Some(idx) => trimmed[..idx].trim_end(),
        None => trimmed,
    };
    Ok(without_comment.to_string())
}

fn unescape_double_quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parse_dotenv_supports_comments_export_and_quotes() {
        let parsed = parse_dotenv(
            "\u{feff}# comment\nexport FOO=from-export\nBAR=\"quoted\\nvalue\"\nBAZ='raw\\n'\nQUX=plain # trailing\nFOO=last-wins\n",
        )
        .expect("parse");
        assert_eq!(parsed.get("FOO").map(String::as_str), Some("last-wins"));
        assert_eq!(parsed.get("BAR").map(String::as_str), Some("quoted\nvalue"));
        assert_eq!(parsed.get("BAZ").map(String::as_str), Some("raw\\n"));
        assert_eq!(parsed.get("QUX").map(String::as_str), Some("plain"));
    }

    #[test]
    fn parse_dotenv_rejects_malformed_lines() {
        let err = parse_dotenv("NOEQUALS\n").expect_err("missing equals");
        assert!(err.contains("missing '='"));
        let err = parse_dotenv("1BAD=value\n").expect_err("bad name");
        assert!(err.contains("bad variable name"));
    }

    #[test]
    fn merge_env_file_then_overlay_wins() {
        let dir = tempfile::tempdir().expect("temp dir");
        let personal = tempfile::tempdir().expect("personal dir");
        let path = dir.path().join(".env");
        fs::write(&path, "FOO=from-file\nBAR=file-only\n").expect("write");
        let mut overlay = HashMap::new();
        overlay.insert("FOO".into(), "from-overlay".into());
        overlay.insert("BAZ".into(), "overlay-only".into());
        let merged =
            merge_mcp_env_file(Some(path.to_str().unwrap()), None, personal.path(), overlay)
                .expect("merge");
        assert_eq!(merged.get("FOO").map(String::as_str), Some("from-overlay"));
        assert_eq!(merged.get("BAR").map(String::as_str), Some("file-only"));
        assert_eq!(merged.get("BAZ").map(String::as_str), Some("overlay-only"));
    }

    #[test]
    fn relative_env_file_resolves_against_project_scope() {
        let dir = tempfile::tempdir().expect("temp dir");
        let personal = tempfile::tempdir().expect("personal dir");
        fs::write(dir.path().join(".env"), "TOKEN=abc\n").expect("write");
        let merged = merge_mcp_env_file(
            Some(".env"),
            Some(dir.path().to_str().unwrap()),
            personal.path(),
            HashMap::new(),
        )
        .expect("merge");
        assert_eq!(merged.get("TOKEN").map(String::as_str), Some("abc"));
    }

    #[test]
    fn relative_env_file_resolves_against_personal_dir() {
        let personal = tempfile::tempdir().expect("personal dir");
        fs::write(personal.path().join(".env"), "TOKEN=personal\n").expect("write");
        for scope in [Some("personal"), None] {
            let merged = merge_mcp_env_file(Some(".env"), scope, personal.path(), HashMap::new())
                .expect("merge");
            assert_eq!(merged.get("TOKEN").map(String::as_str), Some("personal"));
        }
    }

    #[test]
    fn missing_env_file_errors() {
        let personal = tempfile::tempdir().expect("personal dir");
        let err = merge_mcp_env_file(
            Some("/no/such/vixl-mcp-env-file.env"),
            None,
            personal.path(),
            HashMap::new(),
        )
        .expect_err("missing");
        assert!(err.contains("not found"));
    }

    #[test]
    fn empty_env_file_path_errors() {
        let personal = tempfile::tempdir().expect("personal dir");
        let err = merge_mcp_env_file(Some("   "), None, personal.path(), HashMap::new())
            .expect_err("empty");
        assert!(err.contains("empty"));
    }

    #[test]
    fn merged_env_file_still_rejects_dangerous_keys() {
        let dir = tempfile::tempdir().expect("temp dir");
        let personal = tempfile::tempdir().expect("personal dir");
        fs::write(dir.path().join(".env"), "PATH=/evil\nOK=1\n").expect("write");
        let merged = merge_mcp_env_file(
            Some(".env"),
            Some(dir.path().to_str().unwrap()),
            personal.path(),
            HashMap::new(),
        )
        .expect("merge");
        assert!(validate_mcp_env(&merged).is_err());
    }

    #[test]
    fn get_env_vars_returns_only_requested_existing_names() {
        let values = get_env_vars(vec![
            "PATH".into(),
            "VIXL_TEST_GET_ENV_VARS_MISSING".into(),
            "  ".into(),
        ])
        .expect("get_env_vars");
        assert!(values.contains_key("PATH"));
        assert!(!values.contains_key("VIXL_TEST_GET_ENV_VARS_MISSING"));
        assert_eq!(values.len(), 1);
    }
}
