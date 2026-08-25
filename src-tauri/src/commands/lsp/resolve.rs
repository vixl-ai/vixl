use std::collections::HashMap;
use std::path::Path;

use tauri::AppHandle;

use super::super::config::load_lsp_config;
use super::super::lsp_install::{
    find_node_bin, managed_bin_path, managed_typescript_lib, managed_vue_plugin_path,
    managed_vue_typescript_lib,
};
use super::super::lsp_registry::{
    allowlisted_lsp_basenames, builtin_server_map, builtin_spec_by_id, root_marker_score,
    tier_rank, LspInstallKind,
};
use super::super::registry::{get_active_project, registry_list_projects};
use super::helpers::{is_absolute_program, normalize_extension};

#[derive(Clone)]
pub struct LspServerEntry {
    pub(crate) command: Vec<String>,
    pub(crate) extensions: Vec<String>,
    pub(crate) env: HashMap<String, String>,
    pub(crate) initialization: serde_json::Value,
}

pub(crate) fn builtin_lsp_servers() -> HashMap<String, LspServerEntry> {
    let mut servers = HashMap::new();
    for (id, (command, extensions, initialization)) in builtin_server_map() {
        servers.insert(
            id,
            LspServerEntry {
                command,
                extensions,
                env: HashMap::new(),
                initialization,
            },
        );
    }
    servers
}

pub(crate) fn parse_server_entry(value: &serde_json::Value) -> Option<LspServerEntry> {
    let object = value.as_object()?;

    if object
        .get("disabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return None;
    }

    let command = object
        .get("command")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())?;

    let extensions = object
        .get("extensions")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let env = object
        .get("env")
        .and_then(|v| v.as_object())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|v| (key.clone(), v.to_string())))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let initialization = object
        .get("initialization")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    Some(LspServerEntry {
        command,
        extensions,
        env,
        initialization,
    })
}

pub fn resolve_lsp_servers(
    raw: &serde_json::Value,
    base: Option<HashMap<String, LspServerEntry>>,
) -> Option<HashMap<String, LspServerEntry>> {
    if raw.is_boolean() {
        return if raw.as_bool().unwrap_or(false) {
            Some(base.unwrap_or_else(builtin_lsp_servers))
        } else {
            None
        };
    }

    if let Some(object) = raw.as_object() {
        if object.is_empty() {
            return base.or_else(|| Some(builtin_lsp_servers()));
        }

        let mut servers = base.unwrap_or_else(builtin_lsp_servers);

        for (id, value) in object {
            if value
                .get("disabled")
                .and_then(|disabled| disabled.as_bool())
                .unwrap_or(false)
            {
                servers.remove(id);
                continue;
            }

            if let Some(entry) = parse_server_entry(value) {
                if let Some(existing) = servers.get_mut(id) {
                    if !entry.command.is_empty() {
                        existing.command = entry.command;
                    }
                    if !entry.extensions.is_empty() {
                        existing.extensions = entry.extensions;
                    }
                    if !entry.env.is_empty() {
                        existing.env.extend(entry.env);
                    }
                    if entry.initialization != serde_json::json!({}) {
                        existing.initialization = entry.initialization;
                    }
                } else {
                    servers.insert(id.clone(), entry);
                }
            }
        }

        return Some(servers);
    }

    base
}

pub(crate) fn extension_matches(entry: &LspServerEntry, extension: &str) -> bool {
    let normalized = normalize_extension(extension);
    if normalized.is_empty() {
        return false;
    }

    entry.extensions.iter().any(|configured| {
        configured == &normalized
            || configured
                .trim_start_matches('.')
                .eq_ignore_ascii_case(extension.trim_start_matches('.'))
    })
}

pub(crate) fn server_binary_available(
    app: &AppHandle,
    server_id: &str,
    entry: &LspServerEntry,
) -> bool {
    if let Some(spec) = builtin_spec_by_id(server_id) {
        if managed_bin_path(app, spec).is_some() {
            return true;
        }
    }
    let Some(program) = entry.command.first() else {
        return false;
    };
    if is_absolute_program(program) {
        return Path::new(program).is_file();
    }
    which::which(program).is_ok()
}

pub(crate) fn find_server_for_extension(
    app: &AppHandle,
    servers: &HashMap<String, LspServerEntry>,
    extension: &str,
    workspace_root: Option<&str>,
) -> Option<(String, LspServerEntry)> {
    let root_path = workspace_root.map(Path::new);
    let mut candidates: Vec<(String, LspServerEntry)> = servers
        .iter()
        .filter(|(_, entry)| extension_matches(entry, extension))
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();

    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by(|(id_a, entry_a), (id_b, entry_b)| {
        let spec_a = builtin_spec_by_id(id_a);
        let spec_b = builtin_spec_by_id(id_b);

        let marker_a = spec_a
            .map(|spec| root_marker_score(root_path, spec))
            .unwrap_or(100);
        let marker_b = spec_b
            .map(|spec| root_marker_score(root_path, spec))
            .unwrap_or(100);

        let tier_a = spec_a.map(|spec| tier_rank(spec.tier)).unwrap_or(99);
        let tier_b = spec_b.map(|spec| tier_rank(spec.tier)).unwrap_or(99);

        let available_a = if server_binary_available(app, id_a, entry_a) {
            0
        } else {
            1
        };
        let available_b = if server_binary_available(app, id_b, entry_b) {
            0
        } else {
            1
        };

        marker_a
            .cmp(&marker_b)
            .then(tier_a.cmp(&tier_b))
            .then(available_a.cmp(&available_b))
            .then(id_a.cmp(id_b))
    });

    candidates.into_iter().next()
}

pub(crate) fn active_project_root(app: &AppHandle) -> Option<String> {
    let project_id = get_active_project(app.clone()).ok()??;
    let projects = registry_list_projects(app.clone()).ok()?;
    projects
        .into_iter()
        .find(|project| project.id == project_id)
        .map(|project| project.root_path)
}

pub(crate) async fn load_effective_servers(
    app: &AppHandle,
) -> Result<HashMap<String, LspServerEntry>, String> {
    let personal = load_lsp_config(app)?;
    let personal_effective =
        if personal.is_null() || personal.as_object().is_some_and(|o| o.is_empty()) {
            serde_json::json!(true)
        } else {
            personal
        };

    resolve_lsp_servers(&personal_effective, None).ok_or_else(|| {
    "LSP disabled via lsp.json (set to false). Remove that override or enable individual servers."
      .to_string()
  })
}

pub(crate) fn is_allowlisted_basename(program: &str) -> bool {
    let name = Path::new(program)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(program);
    let lower = name.to_ascii_lowercase();
    allowlisted_lsp_basenames()
        .iter()
        .any(|allowed| *allowed == lower || format!("{allowed}.exe") == lower)
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedLspCommand {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) source: String,
}

/// Resolve LSP binary: personal absolute override > managed cache > PATH allowlist > project bins if trusted.
pub(crate) fn resolve_lsp_command(
    app: &AppHandle,
    server_id: &str,
    entry: &LspServerEntry,
    workspace_root: &str,
    trusted: bool,
) -> Result<ResolvedLspCommand, String> {
    let program = entry
        .command
        .first()
        .cloned()
        .ok_or_else(|| "LSP command missing".to_string())?;
    let args = entry.command.iter().skip(1).cloned().collect::<Vec<_>>();

    if is_absolute_program(&program) {
        if Path::new(&program).is_file() {
            return Ok(ResolvedLspCommand {
                program,
                args,
                source: "personal".to_string(),
            });
        }
        return Err(format!("LSP binary not found: {program}"));
    }

    if program.contains('/') || program.contains('\\') {
        if !trusted {
            return Err("Project-relative LSP commands require a trusted workspace".to_string());
        }
        let candidate = Path::new(workspace_root).join(&program);
        if candidate.is_file() {
            return Ok(ResolvedLspCommand {
                program: candidate.to_string_lossy().replace('\\', "/"),
                args,
                source: "project".to_string(),
            });
        }
    }

    if let Some(spec) = builtin_spec_by_id(server_id) {
        if let Some(managed) = managed_bin_path(app, spec) {
            // npm packages are node scripts; spawn via node
            if spec.npm.is_some() {
                let node = find_node_bin(app)
          .map(|p| p.to_string_lossy().replace('\\', "/"))
          .or_else(|| which::which("node").ok().map(|p| p.to_string_lossy().replace('\\', "/")))
          .ok_or_else(|| {
            "Node.js is required for this language server. Enable auto-download or install Node."
              .to_string()
          })?;
                let mut node_args = vec![managed.to_string_lossy().replace('\\', "/")];
                node_args.extend(args);
                return Ok(ResolvedLspCommand {
                    program: node,
                    args: node_args,
                    source: "managed".to_string(),
                });
            }
            return Ok(ResolvedLspCommand {
                program: managed.to_string_lossy().replace('\\', "/"),
                args,
                source: "managed".to_string(),
            });
        }
    }

    if is_allowlisted_basename(&program) {
        if let Ok(path) = which::which(&program) {
            return Ok(ResolvedLspCommand {
                program: path.to_string_lossy().replace('\\', "/"),
                args,
                source: "path".to_string(),
            });
        }
    } else if !trusted {
        return Err(format!(
      "LSP command '{program}' is not allowlisted. Trust the workspace or use a managed/default server."
    ));
    }

    if trusted {
        let local = Path::new(workspace_root)
            .join("node_modules/.bin")
            .join(&program);
        if local.is_file() {
            return Ok(ResolvedLspCommand {
                program: local.to_string_lossy().replace('\\', "/"),
                args,
                source: "project".to_string(),
            });
        }
    }

    Err(format!(
        "LSP server '{server_id}' is not installed yet. {}",
        match builtin_spec_by_id(server_id).map(|spec| spec.install) {
            Some(LspInstallKind::ToolchainPath) => {
                format!(
                    "Install `{program}` on PATH, or configure lsp.servers.{server_id}.command."
                )
            }
            Some(LspInstallKind::None) => {
                "This server is project-local. Trust the workspace and install it there."
                    .to_string()
            }
            _ => "Enable lsp.autoDownload or install the binary.".to_string(),
        }
    ))
}

pub(crate) fn typescript_tsdk_path(app: &AppHandle, workspace_root: &str, trusted: bool) -> String {
    if trusted {
        let project = Path::new(workspace_root).join("node_modules/typescript/lib");
        if project.is_dir() {
            return project.to_string_lossy().replace('\\', "/");
        }
    }
    if let Some(managed) = managed_typescript_lib(app) {
        return managed.to_string_lossy().replace('\\', "/");
    }
    // Vue managed install also ships typescript after we added it as a dependency.
    if let Some(vue_ts) = managed_vue_typescript_lib(app) {
        return vue_ts.to_string_lossy().replace('\\', "/");
    }
    Path::new(workspace_root)
        .join("node_modules/typescript/lib")
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn build_initialization_options(
    app: &AppHandle,
    server_id: &str,
    base: &serde_json::Value,
    workspace_root: &str,
    trusted: bool,
) -> serde_json::Value {
    let mut base = if base.is_null() {
        serde_json::json!({})
    } else {
        base.clone()
    };

    if server_id == "typescript" {
        let plugin_path = if trusted {
            let language_server =
                Path::new(workspace_root).join("node_modules/@vue/language-server");
            if language_server.is_dir() {
                Some(language_server)
            } else {
                let project = Path::new(workspace_root).join("node_modules/@vue/typescript-plugin");
                if project.is_dir() {
                    Some(project)
                } else {
                    managed_vue_plugin_path(app)
                }
            }
        } else {
            managed_vue_plugin_path(app)
        };

        if let Some(plugin_path) = plugin_path {
            let location = plugin_path.to_string_lossy().replace('\\', "/");
            let plugins = serde_json::json!([{
              "name": "@vue/typescript-plugin",
              "location": location,
              "languages": ["vue"],
              "configNamespace": "typescript",
            }]);
            if let Some(obj) = base.as_object_mut() {
                if !obj.contains_key("plugins") {
                    obj.insert("plugins".to_string(), plugins);
                }
            } else {
                base = serde_json::json!({ "plugins": plugins });
            }
        }
    }

    // @vue/language-server v3: typescript.tsdk init option was dropped; pass --tsdk.
    // Prefer the TypeScript bundled with the managed Vue server over the
    // workspace copy (this repo may be on TS 6 while the language server
    // expects the TS 5.x it was installed with).
    if server_id == "vue" {
        let tsdk = managed_vue_typescript_lib(app)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| typescript_tsdk_path(app, workspace_root, trusted));
        if let Some(obj) = base.as_object_mut() {
            let typescript = obj
                .entry("typescript")
                .or_insert_with(|| serde_json::json!({}));
            if let Some(ts_obj) = typescript.as_object_mut() {
                ts_obj.insert("tsdk".to_string(), serde_json::json!(tsdk));
            } else {
                *typescript = serde_json::json!({ "tsdk": tsdk });
            }
        } else {
            base = serde_json::json!({
              "typescript": { "tsdk": tsdk }
            });
        }
    }

    base
}

pub(crate) fn inject_vue_tsdk_arg(
    app: &AppHandle,
    server_id: &str,
    workspace_root: &str,
    trusted: bool,
    resolved: &mut ResolvedLspCommand,
) {
    if server_id != "vue" {
        return;
    }
    if resolved
        .args
        .iter()
        .any(|arg| arg == "--tsdk" || arg.starts_with("--tsdk="))
    {
        return;
    }
    let tsdk = managed_vue_typescript_lib(app)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| typescript_tsdk_path(app, workspace_root, trusted));
    resolved.args.push(format!("--tsdk={tsdk}"));
}

pub(crate) fn workspace_configuration_response(
    app: &AppHandle,
    message: &serde_json::Value,
    workspace_root: &str,
    trusted: bool,
) -> serde_json::Value {
    let items = message
        .get("params")
        .and_then(|params| params.get("items"))
        .and_then(|items| items.as_array());

    let Some(items) = items else {
        return serde_json::json!([]);
    };

    let tsdk = typescript_tsdk_path(app, workspace_root, trusted);
    let typescript_config = serde_json::json!({
      "tsdk": tsdk,
      "preferences": {
        "importModuleSpecifier": "relative",
        "quotePreference": "single",
      }
    });

    let configs = items
        .iter()
        .map(|item| {
            let section = item
                .get("section")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            match section {
                "typescript" | "javascript" => typescript_config.clone(),
                "vue" => serde_json::json!({
                  "complete": { "codelenses": true }
                }),
                _ => serde_json::json!({}),
            }
        })
        .collect::<Vec<_>>();

    serde_json::json!(configs)
}
