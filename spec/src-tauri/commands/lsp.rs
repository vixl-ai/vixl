use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use app_lib::commands::lsp::{
    apply_server_disabled_flag, compute_vue_in_play, merge_vue_plugin_options,
    normalize_lsp_params, pick_typescript_tsdk, resolve_lsp_servers, server_display_label,
    should_inject_vue_typescript_plugin, tsserver_request_body, typescript_lsp_argv,
    typescript_version_supports_native_lsp, unwrap_tsserver_request_tuple,
};
use app_lib::commands::lsp_install::{looks_like_javascript_bin, should_wrap_npm_bin_with_node};
use app_lib::commands::lsp_registry::NpmInstallSpec;

#[test]
fn unwraps_vscode_jsonrpc_wrapped_tsserver_tuple() {
    let params = serde_json::json!([[1, "_vue:projectInfo", { "file": "/tmp/App.vue" }]]);
    let items = unwrap_tsserver_request_tuple(&params).unwrap();
    assert_eq!(items[0], serde_json::json!(1));
    assert_eq!(items[1], serde_json::json!("_vue:projectInfo"));
}

#[test]
fn accepts_unwrapped_tsserver_tuple() {
    let params = serde_json::json!([2, "_vue:quickinfo", { "file": "/tmp/App.vue" }]);
    let items = unwrap_tsserver_request_tuple(&params).unwrap();
    assert_eq!(items[0], serde_json::json!(2));
    assert_eq!(items[1], serde_json::json!("_vue:quickinfo"));
}

#[test]
fn tsserver_request_body_prefers_nested_body() {
    let value = serde_json::json!({
      "type": "response",
      "body": { "displayString": "string" }
    });
    assert_eq!(
        tsserver_request_body(value),
        serde_json::json!({ "displayString": "string" })
    );
}

#[test]
fn tsserver_request_body_falls_back_to_whole_value() {
    let value = serde_json::json!({ "ok": true });
    assert_eq!(
        tsserver_request_body(value),
        serde_json::json!({ "ok": true })
    );
}

#[test]
fn resolve_true_keeps_builtins() {
    let servers = resolve_lsp_servers(&serde_json::json!(true), None).unwrap();
    assert!(servers.contains_key("typescript"));
    assert!(servers.contains_key("vue"));
    assert!(
        !servers.contains_key("biome"),
        "tier D servers stay opt-in by default"
    );
}

#[test]
fn resolve_false_disables_all() {
    assert!(resolve_lsp_servers(&serde_json::json!(false), None).is_none());
}

#[test]
fn resolve_disabled_flag_removes_server() {
    let raw = serde_json::json!({
      "typescript": { "disabled": true }
    });
    let servers = resolve_lsp_servers(&raw, None).unwrap();
    assert!(!servers.contains_key("typescript"));
    assert!(servers.contains_key("vue"));
}

#[test]
fn enabling_biome_writes_opt_in_entry_and_resolves() {
    let mut config = serde_json::json!({});
    let object = config.as_object_mut().unwrap();
    apply_server_disabled_flag(object, "biome", false);

    let biome = object.get("biome").unwrap().as_object().unwrap();
    assert_eq!(biome.get("disabled"), None);
    assert!(biome.get("command").unwrap().as_array().unwrap().len() >= 1);

    let servers = resolve_lsp_servers(&config, None).unwrap();
    assert!(servers.contains_key("biome"));
    assert!(servers.contains_key("typescript"));
}

#[test]
fn enabling_biome_after_disabled_restores_opt_in_entry() {
    let mut config = serde_json::json!({
      "biome": { "disabled": true }
    });
    let object = config.as_object_mut().unwrap();
    apply_server_disabled_flag(object, "biome", false);

    let biome = object.get("biome").unwrap().as_object().unwrap();
    assert_eq!(biome.get("disabled"), None);
    assert!(biome.contains_key("command"));

    let servers = resolve_lsp_servers(&config, None).unwrap();
    assert!(servers.contains_key("biome"));
}

#[test]
fn disabling_biome_marks_disabled_and_drops_from_effective() {
    let mut config = serde_json::json!({});
    let object = config.as_object_mut().unwrap();
    apply_server_disabled_flag(object, "biome", false);
    apply_server_disabled_flag(object, "biome", true);

    assert_eq!(
        object
            .get("biome")
            .unwrap()
            .get("disabled")
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    let servers = resolve_lsp_servers(&config, None).unwrap();
    assert!(!servers.contains_key("biome"));
}

#[test]
fn enabling_default_builtin_clears_disabled_override() {
    let mut config = serde_json::json!({
      "typescript": { "disabled": true }
    });
    let object = config.as_object_mut().unwrap();
    apply_server_disabled_flag(object, "typescript", false);
    assert!(!object.contains_key("typescript"));

    let servers = resolve_lsp_servers(&config, None).unwrap();
    assert!(servers.contains_key("typescript"));
}

#[test]
fn display_label_is_human_readable() {
    assert_eq!(
        server_display_label("typescript"),
        "TypeScript / JavaScript"
    );
    assert_eq!(server_display_label("gopls"), "Go");
    assert_eq!(server_display_label("custom-lsp"), "Custom Lsp");
}

#[test]
fn normalize_strips_non_protocol_keys() {
    let params = serde_json::json!({
      "path": "src/main.ts",
      "content": "export const x = 1",
      "extension": "ts",
      "textDocument": { "uri": "file:///tmp/src/main.ts" },
      "position": { "line": 1, "character": 2 }
    });
    let normalized = normalize_lsp_params("textDocument/definition", params).unwrap();
    let obj = normalized.as_object().unwrap();
    assert!(!obj.contains_key("path"));
    assert!(!obj.contains_key("content"));
    assert!(!obj.contains_key("extension"));
    assert_eq!(
        obj.get("position").unwrap(),
        &serde_json::json!({ "line": 1, "character": 2 })
    );
}

#[test]
fn normalize_injects_references_context() {
    let params = serde_json::json!({
      "textDocument": { "uri": "file:///tmp/src/main.ts" },
      "position": { "line": 4, "character": 0 }
    });
    let normalized = normalize_lsp_params("textDocument/references", params).unwrap();
    assert_eq!(
        normalized.get("context").unwrap(),
        &serde_json::json!({ "includeDeclaration": true })
    );
}

#[test]
fn normalize_rejects_empty_workspace_symbol_query() {
    let params = serde_json::json!({ "query": "  " });
    let err = normalize_lsp_params("workspace/symbol", params).unwrap_err();
    assert!(err.contains("non-empty query"));
}

#[test]
fn normalize_flattens_line_character_into_position() {
    let params = serde_json::json!({
      "textDocument": { "uri": "file:///tmp/src/main.ts" },
      "line": 8,
      "character": 3
    });
    let normalized = normalize_lsp_params("textDocument/hover", params).unwrap();
    assert_eq!(
        normalized.get("position").unwrap(),
        &serde_json::json!({ "line": 8, "character": 3 })
    );
    assert!(normalized.get("line").is_none());
    assert!(normalized.get("character").is_none());
}

#[test]
fn normalize_converts_monaco_line_number_column() {
    let params = serde_json::json!({
      "textDocument": { "uri": "file:///tmp/src/main.ts" },
      "lineNumber": 10,
      "column": 5
    });
    let normalized = normalize_lsp_params("textDocument/definition", params).unwrap();
    assert_eq!(
        normalized.get("position").unwrap(),
        &serde_json::json!({ "line": 9, "character": 4 })
    );
}

#[test]
fn normalize_rejects_missing_position_for_definition() {
    let params = serde_json::json!({
      "textDocument": { "uri": "file:///tmp/src/main.ts" }
    });
    let err = normalize_lsp_params("textDocument/definition", params).unwrap_err();
    assert!(err.contains("requires position"));
}

fn temp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("vixl-lsp-ts-{label}-{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn typescript_command_is_native_tsc_lsp_when_not_vue() {
    assert_eq!(typescript_lsp_argv(false), &["tsc", "--lsp", "--stdio"]);
    assert_ne!(
        typescript_lsp_argv(false).first().copied(),
        Some("typescript-language-server")
    );
}

#[test]
fn typescript_command_is_classic_tls_when_vue() {
    assert_eq!(
        typescript_lsp_argv(true),
        &["typescript-language-server", "--stdio"]
    );
}

#[test]
fn vue_plugin_absent_when_vue_not_in_play() {
    assert!(!should_inject_vue_typescript_plugin(false));
    let options =
        merge_vue_plugin_options(&serde_json::json!({}), Some("/managed/vue/plugin"), false);
    assert!(options.get("plugins").is_none());
}

#[test]
fn vue_plugin_present_when_vue_in_play() {
    assert!(should_inject_vue_typescript_plugin(true));
    let options = merge_vue_plugin_options(
        &serde_json::json!({}),
        Some("/workspace/node_modules/@vue/typescript-plugin"),
        true,
    );
    let plugins = options.get("plugins").and_then(|v| v.as_array()).unwrap();
    assert_eq!(
        plugins[0].get("name").and_then(|v| v.as_str()),
        Some("@vue/typescript-plugin")
    );
}

#[test]
fn leftover_managed_vue_plugin_does_not_inject_for_react() {
    let options = merge_vue_plugin_options(
        &serde_json::json!({}),
        Some("/leftover/@vue/typescript-plugin"),
        false,
    );
    assert!(options.get("plugins").is_none());
}

#[test]
fn non_vue_tsdk_prefers_workspace_then_managed_ts7_not_vue_ts() {
    assert_eq!(
        pick_typescript_tsdk(
            Some("/ws/node_modules/typescript/lib"),
            Some("/managed/ts7/lib"),
            Some("/classic/5.8.2/lib"),
            false,
        ),
        "/ws/node_modules/typescript/lib"
    );
    assert_eq!(
        pick_typescript_tsdk(
            None,
            Some("/managed/ts7/lib"),
            Some("/classic/5.8.2/lib"),
            false
        ),
        "/managed/ts7/lib"
    );
    assert_eq!(
        pick_typescript_tsdk(None, None, Some("/classic/5.8.2/lib"), false),
        ""
    );
}

#[test]
fn vue_in_play_from_workspace_or_running_or_vue_file() {
    let dir = temp_dir("react");
    fs::write(
        dir.join("package.json"),
        r#"{"dependencies":{"react":"19"}}"#,
    )
    .unwrap();
    assert!(!compute_vue_in_play(&dir, Some("ts"), false, false));
    assert!(compute_vue_in_play(&dir, Some("vue"), false, false));
    assert!(compute_vue_in_play(&dir, Some("ts"), true, false));
    assert!(compute_vue_in_play(&dir, Some("tsx"), false, true));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn typescript_7_supports_native_lsp_and_5_does_not() {
    assert!(typescript_version_supports_native_lsp("7.0.2"));
    assert!(typescript_version_supports_native_lsp("Version 7.0.2"));
    assert!(!typescript_version_supports_native_lsp("5.8.2"));
    assert!(!typescript_version_supports_native_lsp("6.0.0"));
}

#[test]
fn native_npm_bins_are_not_wrapped_with_node() {
    let dir = temp_dir("bins");
    let js = dir.join("cli.mjs");
    fs::write(&js, "#!/usr/bin/env node\nexport {}\n").unwrap();
    let native = dir.join("tsc");
    fs::write(&native, b"\x7fELFnative").unwrap();

    let node_spec = NpmInstallSpec {
        packages: &["typescript-language-server@5.3.0"],
        bin: "cli.mjs",
        native: false,
    };
    let native_spec = NpmInstallSpec {
        packages: &["typescript@7.0.2"],
        bin: "tsc",
        native: true,
    };

    assert!(looks_like_javascript_bin(&js));
    assert!(!looks_like_javascript_bin(&native));
    assert!(should_wrap_npm_bin_with_node(&node_spec, &js));
    assert!(!should_wrap_npm_bin_with_node(&native_spec, &js));
    assert!(!should_wrap_npm_bin_with_node(&native_spec, &native));
    let _ = fs::remove_dir_all(&dir);
}
