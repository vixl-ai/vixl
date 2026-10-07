use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use app_lib::commands::lsp::{
    append_stderr_snippet, apply_diagnostic_registrations, apply_server_disabled_flag,
    compute_vue_in_play, dependent_server_ids, forget_open_document, is_lsp_method_not_found,
    lsp_invalid_stream_error, lsp_request_timeout_error, merge_vue_plugin_options,
    normalize_lsp_method, normalize_lsp_params, parse_diagnostic_provider,
    parse_workspace_diagnostic_report, pick_typescript_tsdk, read_lsp_message, resolve_lsp_servers,
    server_display_label, should_inject_vue_typescript_plugin, start_lock_for,
    tsserver_request_body, typescript_lsp_argv, typescript_version_supports_native_lsp,
    unwrap_tsserver_request_tuple, with_typescript_tsdk,
};
use app_lib::commands::lsp_install::{
    looks_like_javascript_bin, should_wrap_npm_bin_with_node, with_timeout,
};
use app_lib::commands::lsp_registry::NpmInstallSpec;
use tokio::sync::Mutex;

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
    assert_eq!(
        server_display_label("typescript-classic"),
        "TypeScript (Vue / Nuxt Hybrid)"
    );
    assert_eq!(server_display_label("gopls"), "Go");
    assert_eq!(server_display_label("sql"), "Postgres");
    assert_eq!(server_display_label("custom-lsp"), "Custom Lsp");
}

#[test]
fn lsp_uninstall_stops_classic_typescript_dependents() {
    assert_eq!(
        dependent_server_ids("typescript-classic"),
        &["typescript", "vue"]
    );
    assert!(dependent_server_ids("typescript").is_empty());
    assert!(dependent_server_ids("vue").is_empty());
    assert!(dependent_server_ids("rust-analyzer").is_empty());
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
fn typescript_tsdk_from_null_base() {
    assert_eq!(
        with_typescript_tsdk(serde_json::Value::Null, "/managed/astro/lib"),
        serde_json::json!({
            "typescript": { "tsdk": "/managed/astro/lib" }
        })
    );
}

#[test]
fn typescript_tsdk_from_empty_object() {
    assert_eq!(
        with_typescript_tsdk(serde_json::json!({}), "/managed/vue/lib"),
        serde_json::json!({
            "typescript": { "tsdk": "/managed/vue/lib" }
        })
    );
}

#[test]
fn typescript_tsdk_preserves_other_top_level_keys() {
    assert_eq!(
        with_typescript_tsdk(
            serde_json::json!({
                "vue": { "complete": { "codelenses": true } },
                "contentIntellisense": true
            }),
            "/managed/astro/lib"
        ),
        serde_json::json!({
            "vue": { "complete": { "codelenses": true } },
            "contentIntellisense": true,
            "typescript": { "tsdk": "/managed/astro/lib" }
        })
    );
}

#[test]
fn typescript_tsdk_preserves_existing_typescript_keys_and_overwrites_tsdk() {
    assert_eq!(
        with_typescript_tsdk(
            serde_json::json!({
                "typescript": { "locale": "en", "tsdk": "/old/lib" }
            }),
            "/managed/astro/lib"
        ),
        serde_json::json!({
            "typescript": { "locale": "en", "tsdk": "/managed/astro/lib" }
        })
    );
}

#[test]
fn typescript_tsdk_replaces_non_object_typescript_value() {
    assert_eq!(
        with_typescript_tsdk(
            serde_json::json!({ "other": 1, "typescript": "not-an-object" }),
            "/managed/astro/lib"
        ),
        serde_json::json!({
            "other": 1,
            "typescript": { "tsdk": "/managed/astro/lib" }
        })
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

#[tokio::test]
async fn start_mutex_serializes_two_ensures_of_the_same_id() {
    let id = format!(
        "test-start-lock-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let order = Arc::new(Mutex::new(Vec::<String>::new()));

    let run = |label: &'static str| {
        let id = id.clone();
        let order = order.clone();
        async move {
            let lock = start_lock_for(&id).await;
            let _guard = lock.lock().await;
            order.lock().await.push(format!("{label}-enter"));
            tokio::time::sleep(Duration::from_millis(40)).await;
            order.lock().await.push(format!("{label}-leave"));
        }
    };

    tokio::join!(run("a"), run("b"));
    let seq = order.lock().await.clone();
    assert!(
        seq == ["a-enter", "a-leave", "b-enter", "b-leave"]
            || seq == ["b-enter", "b-leave", "a-enter", "a-leave"],
        "expected serialized lock order, got {seq:?}"
    );
}

#[tokio::test]
async fn write_timeout_maps_to_error() {
    let result = with_timeout(
        Duration::from_millis(30),
        std::future::pending::<Result<(), String>>(),
        "LSP write timed out after 10s",
    )
    .await;
    assert_eq!(result.unwrap_err(), "LSP write timed out after 10s");
}

#[test]
fn request_timeout_error_includes_method() {
    assert_eq!(
        lsp_request_timeout_error(30, "initialize"),
        "LSP request timed out after 30s (initialize)"
    );
}

#[test]
fn fail_fast_exit_error_includes_stderr_snippet() {
    let message = append_stderr_snippet(
        "Language server exited while waiting for initialize".to_string(),
        "node: not found\n",
    );
    assert!(message.contains("exited while waiting for initialize"));
    assert!(message.contains("node: not found"));
    assert!(!message.contains("timed out after 30s"));
}

#[test]
fn empty_stderr_keeps_base_message() {
    assert_eq!(
        append_stderr_snippet("Language server exited".to_string(), "  \n"),
        "Language server exited"
    );
}

#[test]
fn invalid_stream_error_mentions_not_valid_lsp() {
    let message = lsp_invalid_stream_error("Invalid LSP header");
    assert!(message.contains("Invalid LSP header"));
    assert!(message.contains("stream was not valid LSP"));
}

#[tokio::test]
async fn read_lsp_message_rejects_non_lsp_stream() {
    let (client, mut server) = tokio::io::duplex(16_384);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let _ = server.write_all(&[b'x'; 9000]).await;
    });
    let mut reader = tokio::io::BufReader::new(client);
    let err = read_lsp_message(&mut reader).await.unwrap_err();
    assert!(
        err.contains("not valid LSP"),
        "expected invalid LSP error, got {err}"
    );
}

#[tokio::test]
async fn read_lsp_message_rejects_header_without_content_length() {
    let (client, mut server) = tokio::io::duplex(128);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let _ = server.write_all(b"Content-Type: text\r\n\r\n").await;
    });
    let mut reader = tokio::io::BufReader::new(client);
    let err = read_lsp_message(&mut reader).await.unwrap_err();
    assert!(err.contains("not valid LSP"), "got {err}");
    assert!(err.contains("Content-Length"), "got {err}");
}

#[tokio::test]
async fn read_lsp_message_incomplete_header_is_not_valid_lsp() {
    let (client, mut server) = tokio::io::duplex(128);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let _ = server.write_all(b"not-a-header").await;
    });
    let mut reader = tokio::io::BufReader::new(client);
    let err = read_lsp_message(&mut reader).await.unwrap_err();
    assert!(err.contains("not valid LSP"), "got {err}");
}

#[tokio::test]
async fn read_lsp_message_empty_eof_is_exit() {
    let (client, server) = tokio::io::duplex(8);
    drop(server);
    let mut reader = tokio::io::BufReader::new(client);
    let err = read_lsp_message(&mut reader).await.unwrap_err();
    assert_eq!(err, "Language server exited");
}

#[test]
fn normalize_maps_workspace_diagnostics_alias() {
    assert_eq!(
        normalize_lsp_method("workspaceDiagnostics").unwrap(),
        "workspace/diagnostic"
    );
    assert_eq!(
        normalize_lsp_method("workspace/diagnostic").unwrap(),
        "workspace/diagnostic"
    );
}

#[test]
fn parse_initialize_diagnostic_provider() {
    let init = serde_json::json!({
      "capabilities": {
        "diagnosticProvider": {
          "identifier": "rustc",
          "interFileDependencies": true,
          "workspaceDiagnostics": true
        }
      }
    });
    let provider = parse_diagnostic_provider(&init).unwrap();
    assert!(provider.workspace_diagnostics);
    assert_eq!(provider.identifier.as_deref(), Some("rustc"));

    let missing = serde_json::json!({ "capabilities": {} });
    assert!(parse_diagnostic_provider(&missing).is_none());

    let pull_only = serde_json::json!({
      "capabilities": {
        "diagnosticProvider": {
          "workspaceDiagnostics": false
        }
      }
    });
    let provider = parse_diagnostic_provider(&pull_only).unwrap();
    assert!(!provider.workspace_diagnostics);
}

#[test]
fn parse_workspace_report_into_uri_items() {
    let report = serde_json::json!({
      "items": [
        {
          "kind": "full",
          "uri": "file:///tmp/src/foo.rs",
          "version": 1,
          "items": [{ "message": "unused", "severity": 2 }]
        },
        {
          "kind": "unchanged",
          "uri": "file:///tmp/src/bar.rs",
          "version": 1,
          "resultId": "1"
        }
      ]
    });
    let parsed = parse_workspace_diagnostic_report(&report);
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0].kind, "full");
    assert_eq!(parsed[0].uri, "file:///tmp/src/foo.rs");
    assert_eq!(
        parsed[0].diagnostics,
        serde_json::json!([{ "message": "unused", "severity": 2 }])
    );
    assert_eq!(parsed[1].kind, "unchanged");
    assert_eq!(parsed[1].uri, "file:///tmp/src/bar.rs");
    assert_eq!(parsed[1].diagnostics, serde_json::json!([]));
}

#[test]
fn method_not_found_falls_back_to_open_documents() {
    assert!(is_lsp_method_not_found("Method not found (code -32601)"));
    assert!(is_lsp_method_not_found("unhandled method"));
    assert!(is_lsp_method_not_found("method not found"));
    assert!(!is_lsp_method_not_found("LSP request timed out after 60s"));
}

#[test]
fn document_close_keeps_diagnostics_cache() {
    let mut open_documents = HashMap::from([("file:///tmp/a.ts".to_string(), 1)]);
    let diagnostics_by_uri = HashMap::from([(
        "file:///tmp/a.ts".to_string(),
        serde_json::json!([{ "message": "unused" }]),
    )]);
    forget_open_document(&mut open_documents, "file:///tmp/a.ts");
    assert!(open_documents.is_empty());
    assert!(diagnostics_by_uri.contains_key("file:///tmp/a.ts"));
}

#[test]
fn register_capability_enables_workspace_diagnostics() {
    let mut current = None;
    apply_diagnostic_registrations(
        &mut current,
        &serde_json::json!({
          "registrations": [{
            "id": "1",
            "method": "textDocument/diagnostic",
            "registerOptions": {
              "identifier": "typescript",
              "workspaceDiagnostics": true
            }
          }]
        }),
    );
    let provider = current.unwrap();
    assert!(provider.workspace_diagnostics);
    assert_eq!(provider.identifier.as_deref(), Some("typescript"));
}
