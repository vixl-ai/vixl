use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use super::super::lsp_install::{
    managed_classic_typescript_lib, managed_typescript_lib, managed_vue_plugin_path,
    managed_vue_typescript_lib, native_typescript_exe,
};
use super::super::lsp_registry::{builtin_spec_by_id, workspace_is_vue_nuxt, BuiltinLspSpec};

lazy_static::lazy_static! {
    static ref VUE_CLASSIC_WORKSPACES: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

fn normalize_root(root: &str) -> String {
    root.replace('\\', "/")
}

pub fn extension_is_vue(extension: Option<&str>) -> bool {
    let Some(extension) = extension else {
        return false;
    };
    extension
        .trim_start_matches('.')
        .eq_ignore_ascii_case("vue")
}

pub fn compute_vue_in_play(
    root: &Path,
    extension: Option<&str>,
    vue_running: bool,
    marked: bool,
) -> bool {
    workspace_is_vue_nuxt(root) || vue_running || extension_is_vue(extension) || marked
}

pub fn workspace_marked_vue_classic(root: &str) -> bool {
    VUE_CLASSIC_WORKSPACES
        .lock()
        .map(|set| set.contains(&normalize_root(root)))
        .unwrap_or(false)
}

pub fn mark_vue_classic_workspace(root: &str) {
    if let Ok(mut set) = VUE_CLASSIC_WORKSPACES.lock() {
        set.insert(normalize_root(root));
    }
}

pub fn vue_in_play_for(workspace_root: &str, extension: Option<&str>, vue_running: bool) -> bool {
    let in_play = compute_vue_in_play(
        Path::new(workspace_root),
        extension,
        vue_running,
        workspace_marked_vue_classic(workspace_root),
    );
    if in_play {
        mark_vue_classic_workspace(workspace_root);
    }
    in_play
}

pub fn typescript_lsp_argv(classic: bool) -> &'static [&'static str] {
    if classic {
        &["typescript-language-server", "--stdio"]
    } else {
        &["tsc", "--lsp", "--stdio"]
    }
}

pub fn is_builtin_typescript_command(command: &[String]) -> bool {
    matches!(
        command.first().map(String::as_str),
        Some("tsc") | Some("typescript-language-server")
    )
}

pub fn apply_typescript_stack_command(command: &mut Vec<String>, classic: bool) {
    if !is_builtin_typescript_command(command) {
        return;
    }
    *command = typescript_lsp_argv(classic)
        .iter()
        .map(|part| (*part).to_string())
        .collect();
}

pub fn typescript_install_spec(classic: bool) -> Option<&'static BuiltinLspSpec> {
    if classic {
        builtin_spec_by_id("typescript-classic")
    } else {
        builtin_spec_by_id("typescript")
    }
}

pub fn resolve_spec_for_command<'a>(
    server_id: &str,
    classic_typescript: bool,
) -> Option<&'static BuiltinLspSpec> {
    if server_id == "typescript" {
        typescript_install_spec(classic_typescript)
    } else {
        builtin_spec_by_id(server_id)
    }
}

pub fn should_inject_vue_typescript_plugin(vue_in_play: bool) -> bool {
    vue_in_play
}

pub fn typescript_version_supports_native_lsp(version: &str) -> bool {
    let trimmed = version.trim().trim_start_matches('v');
    let digits = trimmed
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>();
    digits.parse::<u32>().ok().is_some_and(|major| major >= 7)
}

fn read_typescript_package_version(package_json: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(package_json).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

pub fn workspace_native_tsc(workspace_root: &str, trusted: bool) -> Option<PathBuf> {
    if !trusted {
        return None;
    }
    let node_modules = Path::new(workspace_root).join("node_modules");
    let version = read_typescript_package_version(&node_modules.join("typescript/package.json"))?;
    if !typescript_version_supports_native_lsp(&version) {
        return None;
    }
    native_typescript_exe(&node_modules).or_else(|| {
        let unix = node_modules.join(".bin/tsc");
        if unix.is_file() {
            return Some(unix);
        }
        if cfg!(windows) {
            let exe = node_modules.join(".bin/tsc.exe");
            if exe.is_file() {
                return Some(exe);
            }
        }
        None
    })
}

pub fn pick_typescript_tsdk(
    workspace_lib: Option<&str>,
    managed_ts_lib: Option<&str>,
    managed_classic_lib: Option<&str>,
    classic: bool,
) -> String {
    if let Some(workspace) = workspace_lib {
        if !workspace.is_empty() {
            return workspace.to_string();
        }
    }
    if classic {
        if let Some(classic_lib) = managed_classic_lib {
            if !classic_lib.is_empty() {
                return classic_lib.to_string();
            }
        }
    } else if let Some(managed) = managed_ts_lib {
        if !managed.is_empty() {
            return managed.to_string();
        }
    }
    workspace_lib.unwrap_or_default().to_string()
}

fn workspace_typescript_lib(workspace_root: &str, trusted: bool) -> Option<String> {
    if !trusted {
        return None;
    }
    let project = Path::new(workspace_root).join("node_modules/typescript/lib");
    if project.is_dir() {
        Some(project.to_string_lossy().replace('\\', "/"))
    } else {
        None
    }
}

pub(crate) fn typescript_tsdk_path(
    app: &AppHandle,
    workspace_root: &str,
    trusted: bool,
    classic: bool,
) -> String {
    let workspace = workspace_typescript_lib(workspace_root, trusted);
    let managed = managed_typescript_lib(app).map(|path| path.to_string_lossy().replace('\\', "/"));
    let classic_lib =
        managed_classic_typescript_lib(app).map(|path| path.to_string_lossy().replace('\\', "/"));
    let picked = pick_typescript_tsdk(
        workspace.as_deref(),
        managed.as_deref(),
        classic_lib.as_deref(),
        classic,
    );
    if picked.is_empty() {
        Path::new(workspace_root)
            .join("node_modules/typescript/lib")
            .to_string_lossy()
            .replace('\\', "/")
    } else {
        picked
    }
}

pub fn merge_vue_plugin_options(
    base: &serde_json::Value,
    plugin_location: Option<&str>,
    vue_in_play: bool,
) -> serde_json::Value {
    let mut base = if base.is_null() {
        serde_json::json!({})
    } else {
        base.clone()
    };
    if !should_inject_vue_typescript_plugin(vue_in_play) {
        return base;
    }
    let Some(location) = plugin_location else {
        return base;
    };
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
    base
}

fn vue_plugin_location(app: &AppHandle, workspace_root: &str, trusted: bool) -> Option<String> {
    if trusted {
        let language_server = Path::new(workspace_root).join("node_modules/@vue/language-server");
        if language_server.is_dir() {
            return Some(language_server.to_string_lossy().replace('\\', "/"));
        }
        let project = Path::new(workspace_root).join("node_modules/@vue/typescript-plugin");
        if project.is_dir() {
            return Some(project.to_string_lossy().replace('\\', "/"));
        }
    }
    managed_vue_plugin_path(app).map(|path| path.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn build_initialization_options(
    app: &AppHandle,
    server_id: &str,
    base: &serde_json::Value,
    workspace_root: &str,
    trusted: bool,
    vue_in_play: bool,
) -> serde_json::Value {
    let mut base = if server_id == "typescript" {
        merge_vue_plugin_options(
            base,
            vue_plugin_location(app, workspace_root, trusted).as_deref(),
            vue_in_play,
        )
    } else if base.is_null() {
        serde_json::json!({})
    } else {
        base.clone()
    };

    if server_id == "vue" {
        let tsdk = managed_vue_typescript_lib(app)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| typescript_tsdk_path(app, workspace_root, trusted, true));
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
    args: &mut Vec<String>,
) {
    if server_id != "vue" {
        return;
    }
    if args
        .iter()
        .any(|arg| arg == "--tsdk" || arg.starts_with("--tsdk="))
    {
        return;
    }
    let tsdk = managed_vue_typescript_lib(app)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| typescript_tsdk_path(app, workspace_root, trusted, true));
    args.push(format!("--tsdk={tsdk}"));
}

pub(crate) fn workspace_configuration_response(
    app: &AppHandle,
    message: &serde_json::Value,
    workspace_root: &str,
    trusted: bool,
    vue_in_play: bool,
) -> serde_json::Value {
    let items = message
        .get("params")
        .and_then(|params| params.get("items"))
        .and_then(|items| items.as_array());

    let Some(items) = items else {
        return serde_json::json!([]);
    };

    let tsdk = typescript_tsdk_path(app, workspace_root, trusted, vue_in_play);
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
