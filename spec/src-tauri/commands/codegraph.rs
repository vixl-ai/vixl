use std::path::Path;

use app_lib::commands::codegraph::{
    graph_id_for_root, resolve_graph_delete_dir, rewrite_codegraph_path, validate_action,
};

#[test]
fn validate_action_allows_init_and_index() {
    assert!(validate_action("init").is_ok());
    assert!(validate_action("INIT").is_ok());
    assert!(validate_action("index").is_ok());
    assert!(validate_action("INDEX").is_ok());
    assert!(validate_action("serve").is_err());
    assert!(validate_action("sync").is_err());
}

#[test]
fn graph_id_for_root_is_stable_sha256_hex() {
    let root = Path::new("/Users/aidan/Projects/demo");
    let first = graph_id_for_root(root);
    let second = graph_id_for_root(root);
    assert_eq!(first, second);
    assert_eq!(first.len(), 64);
    assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
    assert_eq!(
        first,
        "176f69c2e4ca958e8765d14d55f883f62138281d1ac9f3e8545a15b64fdcca1c"
    );
    assert_ne!(
        graph_id_for_root(Path::new("/Users/aidan/Projects/other")),
        first
    );
}

#[test]
fn resolve_graph_delete_dir_rejects_escape() {
    let store = Path::new("/tmp/vixl-graphs");
    let valid = "176f69c2e4ca958e8765d14d55f883f62138281d1ac9f3e8545a15b64fdcca1c";
    let resolved = resolve_graph_delete_dir(store, valid).expect("valid id");
    assert_eq!(resolved, store.join(valid));

    assert!(resolve_graph_delete_dir(store, "..").is_err());
    assert!(resolve_graph_delete_dir(store, "../etc").is_err());
    assert!(resolve_graph_delete_dir(store, "foo/bar").is_err());
    assert!(resolve_graph_delete_dir(store, "/tmp/escape").is_err());
    assert!(resolve_graph_delete_dir(store, "").is_err());
    assert!(resolve_graph_delete_dir(store, "not-hex").is_err());
}

#[test]
fn rewrite_codegraph_path_maps_project_dir_onto_store() {
    let project = "/Users/aidan/Projects/demo";
    let store = "/Users/aidan/Library/Application Support/vixl/.vixl/graphs/abc";
    assert_eq!(
        rewrite_codegraph_path("/Users/aidan/Projects/demo/.codegraph", project, store),
        store
    );
    assert_eq!(
        rewrite_codegraph_path(
            "/Users/aidan/Projects/demo/.codegraph/codegraph.db",
            project,
            store
        ),
        format!("{store}/codegraph.db")
    );
    assert_eq!(
        rewrite_codegraph_path("/Users/aidan/Projects/demo/src/main.rs", project, store),
        "/Users/aidan/Projects/demo/src/main.rs"
    );
    assert_eq!(
        rewrite_codegraph_path(
            r"C:\work\demo\.codegraph\codegraph.db",
            r"C:\work\demo",
            r"C:\Users\aidan\vixl\graphs\abc"
        ),
        r"C:\Users\aidan\vixl\graphs\abc\codegraph.db"
    );
}
