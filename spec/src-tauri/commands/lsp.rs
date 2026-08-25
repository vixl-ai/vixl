use app_lib::commands::lsp::{
    apply_server_disabled_flag, normalize_lsp_params, resolve_lsp_servers, server_display_label,
    tsserver_request_body, unwrap_tsserver_request_tuple,
};

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
