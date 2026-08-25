use std::path::Path;

use serde::Serialize;

use super::super::lsp_registry::{
    builtin_server_map, builtin_spec_by_id, BuiltinLspSpec, LspInstallKind,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStatus {
    pub id: String,
    pub running: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_state: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCatalogEntry {
    pub id: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub install_kind: String,
    pub requires_trust: bool,
    pub installable: bool,
    pub installed: bool,
    pub running: bool,
    pub disabled: bool,
    pub error: Option<String>,
    pub source: Option<String>,
    pub install_state: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspDiagnosticsEvent {
    pub(crate) uri: String,
    pub(crate) diagnostics: serde_json::Value,
    pub(crate) server_id: String,
}

pub fn server_display_label(id: &str) -> String {
    match id {
        "typescript" => "TypeScript / JavaScript".to_string(),
        "vue" => "Vue / Nuxt".to_string(),
        "json" => "JSON".to_string(),
        "yaml" => "YAML".to_string(),
        "markdown" => "Markdown".to_string(),
        "python" => "Python".to_string(),
        "rust" => "Rust".to_string(),
        "gopls" => "Go".to_string(),
        "bash" => "Bash".to_string(),
        "html" => "HTML".to_string(),
        "css" => "CSS".to_string(),
        "tailwindcss" => "Tailwind CSS".to_string(),
        "svelte" => "Svelte".to_string(),
        "astro" => "Astro".to_string(),
        "prisma" => "Prisma".to_string(),
        "graphql" => "GraphQL".to_string(),
        "dockerfile" => "Dockerfile".to_string(),
        "lua" => "Lua".to_string(),
        "clangd" => "C / C++".to_string(),
        "terraform" => "Terraform".to_string(),
        "toml" => "TOML".to_string(),
        "zig" => "Zig".to_string(),
        "php" => "PHP".to_string(),
        "kotlin" => "Kotlin".to_string(),
        "xml" => "XML".to_string(),
        "sql" => "SQL".to_string(),
        "java" => "Java".to_string(),
        "eslint" => "ESLint".to_string(),
        "oxlint" => "Oxlint".to_string(),
        "biome" => "Biome".to_string(),
        "deno" => "Deno".to_string(),
        "ruby-lsp" => "Ruby".to_string(),
        "sourcekit-lsp" => "Swift".to_string(),
        "hls" => "Haskell".to_string(),
        other => other
            .split(|c| c == '-' || c == '_')
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

pub(crate) fn install_kind_label(kind: LspInstallKind) -> &'static str {
    match kind {
        LspInstallKind::Npm => "npm",
        LspInstallKind::GithubRelease => "github",
        LspInstallKind::HttpArchive => "http",
        LspInstallKind::GoInstall => "go",
        LspInstallKind::ToolchainPath => "toolchain",
        LspInstallKind::None => "none",
    }
}

pub(crate) fn is_managed_install_kind(kind: LspInstallKind) -> bool {
    matches!(
        kind,
        LspInstallKind::Npm
            | LspInstallKind::GithubRelease
            | LspInstallKind::HttpArchive
            | LspInstallKind::GoInstall
    )
}

pub(crate) fn normalize_extension(extension: &str) -> String {
    let trimmed = extension.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with('.') {
        trimmed.to_string()
    } else {
        format!(".{trimmed}")
    }
}

pub(crate) fn path_to_uri(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if !normalized.starts_with('/') {
        normalized = format!("/{normalized}");
    }
    format!("file://{normalized}")
}

pub(crate) fn is_absolute_program(program: &str) -> bool {
    Path::new(program).is_absolute()
        || (cfg!(windows)
            && program.len() > 2
            && program.as_bytes()[1] == b':'
            && (program.as_bytes()[2] == b'\\' || program.as_bytes()[2] == b'/'))
}

pub(crate) fn normalize_lsp_method(method: &str) -> Result<&str, String> {
    match method {
    "goToDefinition" => Ok("textDocument/definition"),
    "hover" => Ok("textDocument/hover"),
    "findReferences" => Ok("textDocument/references"),
    "symbols" | "documentSymbol" => Ok("textDocument/documentSymbol"),
    "workspaceSymbol" | "workspace/symbol" => Ok("workspace/symbol"),
    "diagnostics" | "publishDiagnostics" => Ok("textDocument/diagnostic"),
    "workspace/executeCommand" | "executeCommand" => {
      Err("workspace/executeCommand is not allowed".to_string())
    }
    other if other.starts_with("textDocument/") || other.starts_with("workspace/") => {
      if other.contains("executeCommand") {
        return Err("executeCommand is not allowed".to_string());
      }
      Ok(other)
    }
    other => Err(format!(
      "Unsupported LSP method '{other}'. Use goToDefinition, findReferences, hover, symbols, workspaceSymbol, or diagnostics."
    )),
  }
}

pub(crate) fn lsp_method_is_notification(method: &str) -> bool {
    matches!(
        method,
        "initialized"
            | "exit"
            | "textDocument/didOpen"
            | "textDocument/didChange"
            | "textDocument/didClose"
    )
}

pub(crate) fn position_needs_method(method: &str) -> bool {
    matches!(
        method,
        "textDocument/definition"
            | "textDocument/hover"
            | "textDocument/references"
            | "textDocument/completion"
    )
}

pub(crate) fn as_u64_position_coord(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().filter(|n| *n >= 0).map(|n| n as u64))
        .or_else(|| {
            value
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0)
                .map(|n| n as u64)
        })
}

pub(crate) fn normalize_position_into(obj: &mut serde_json::Map<String, serde_json::Value>) {
    if let Some(position) = obj.get("position").cloned() {
        if let Some(pos) = position.as_object() {
            let line = pos.get("line").and_then(as_u64_position_coord).or_else(|| {
                pos.get("lineNumber")
                    .and_then(as_u64_position_coord)
                    .map(|n| n.saturating_sub(1))
            });
            let character = pos
                .get("character")
                .and_then(as_u64_position_coord)
                .or_else(|| {
                    pos.get("column")
                        .and_then(as_u64_position_coord)
                        .map(|n| n.saturating_sub(1))
                });
            if let (Some(line), Some(character)) = (line, character) {
                obj.insert(
                    "position".to_string(),
                    serde_json::json!({ "line": line, "character": character }),
                );
                return;
            }
        }
    }

    let flat_line = obj.get("line").and_then(as_u64_position_coord);
    let flat_character = obj.get("character").and_then(as_u64_position_coord);
    if let (Some(line), Some(character)) = (flat_line, flat_character) {
        obj.remove("line");
        obj.remove("character");
        obj.insert(
            "position".to_string(),
            serde_json::json!({ "line": line, "character": character }),
        );
        return;
    }

    let monaco_line = obj.get("lineNumber").and_then(as_u64_position_coord);
    let monaco_column = obj.get("column").and_then(as_u64_position_coord);
    if let (Some(line_number), Some(column)) = (monaco_line, monaco_column) {
        obj.remove("lineNumber");
        obj.remove("column");
        obj.insert(
            "position".to_string(),
            serde_json::json!({
              "line": line_number.saturating_sub(1),
              "character": column.saturating_sub(1),
            }),
        );
    }
}

pub fn normalize_lsp_params(
    method: &str,
    mut params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let Some(obj) = params.as_object_mut() else {
        return Ok(params);
    };

    for key in ["path", "content", "extension"] {
        obj.remove(key);
    }

    normalize_position_into(obj);

    if method == "textDocument/references" {
        let context = obj
            .entry("context")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(ctx) = context.as_object_mut() {
            ctx.entry("includeDeclaration")
                .or_insert(serde_json::json!(true));
        }
    }

    if method == "workspace/symbol" {
        let query = obj
            .get("query")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        if query.is_empty() {
            return Err("workspace/symbol requires a non-empty query".to_string());
        }
    }

    if position_needs_method(method) {
        let has_position = obj
            .get("position")
            .and_then(|value| value.as_object())
            .map(|pos| {
                pos.get("line").and_then(as_u64_position_coord).is_some()
                    && pos
                        .get("character")
                        .and_then(as_u64_position_coord)
                        .is_some()
            })
            .unwrap_or(false);
        if !has_position {
            return Err(format!(
                "{method} requires position {{ line, character }} (0-based)"
            ));
        }
    }

    Ok(params)
}

pub(crate) fn opt_in_server_entry(spec: &BuiltinLspSpec) -> serde_json::Value {
    serde_json::json!({
      "command": spec.command,
      "extensions": spec.extensions,
    })
}

pub(crate) fn is_default_enabled_builtin(server_id: &str) -> bool {
    builtin_server_map().contains_key(server_id)
}

/// Apply enable/disable to an lsp.json object. Opt-in servers (Tier D: biome, eslint, oxlint)
/// are absent from the default builtin map, so enabling them writes a full command entry.
pub fn apply_server_disabled_flag(
    object: &mut serde_json::Map<String, serde_json::Value>,
    server_id: &str,
    disabled: bool,
) {
    if disabled {
        let entry = object
            .entry(server_id.to_string())
            .or_insert_with(|| serde_json::json!({}));
        if let Some(entry_object) = entry.as_object_mut() {
            entry_object.insert("disabled".to_string(), serde_json::Value::Bool(true));
        } else {
            *entry = serde_json::json!({ "disabled": true });
        }
        return;
    }

    // Enabling
    let opt_in_spec =
        builtin_spec_by_id(server_id).filter(|spec| !is_default_enabled_builtin(spec.id));

    if let Some(spec) = opt_in_spec {
        object.insert(server_id.to_string(), opt_in_server_entry(spec));
        return;
    }

    if let Some(entry) = object.get_mut(server_id) {
        if let Some(entry_object) = entry.as_object_mut() {
            entry_object.remove("disabled");
            if entry_object.is_empty() {
                object.remove(server_id);
            }
        }
    }
}
