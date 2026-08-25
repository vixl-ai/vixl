use app_lib::commands::fs::{build_hunks, is_sensitive_relative_path};

#[test]
fn build_hunks_empty_when_identical() {
    let hunks = build_hunks("a\nb\n", "a\nb\n");
    assert!(hunks.is_empty());
}

#[test]
fn build_hunks_middle_change_is_focused() {
    let old = "line1\nline2\nline3\nline4\nline5\nline6\nline7\n";
    let new = "line1\nline2\nline3\nchanged\nline5\nline6\nline7\n";
    let hunks = build_hunks(old, new);
    assert_eq!(hunks.len(), 1);
    let hunk = &hunks[0];
    let removes: Vec<_> = hunk
        .lines
        .iter()
        .filter(|line| line.kind == "remove")
        .collect();
    let adds: Vec<_> = hunk
        .lines
        .iter()
        .filter(|line| line.kind == "add")
        .collect();
    assert_eq!(removes.len(), 1);
    assert_eq!(adds.len(), 1);
    assert_eq!(removes[0].content, "line4");
    assert_eq!(adds[0].content, "changed");
    assert!(hunk.lines.iter().any(|line| line.kind == "context"));
    // Must not paint the whole file as remove-then-add.
    assert!(hunk.lines.len() < 14);
}

#[test]
fn build_hunks_create_file() {
    let hunks = build_hunks("", "hello\nworld\n");
    assert_eq!(hunks.len(), 1);
    assert!(hunks[0].lines.iter().all(|line| line.kind == "add"));
    assert_eq!(hunks[0].lines.len(), 2);
}

#[test]
fn build_hunks_delete_file() {
    let hunks = build_hunks("hello\nworld\n", "");
    assert_eq!(hunks.len(), 1);
    assert!(hunks[0].lines.iter().all(|line| line.kind == "remove"));
    assert_eq!(hunks[0].lines.len(), 2);
}

#[test]
fn sensitive_paths_are_blocked() {
    assert!(is_sensitive_relative_path(".env"));
    assert!(is_sensitive_relative_path(".env.local"));
    assert!(is_sensitive_relative_path("config/.env"));
    assert!(is_sensitive_relative_path(".ssh/id_rsa"));
    assert!(is_sensitive_relative_path("certs/server.pem"));
    assert!(is_sensitive_relative_path("keys/api.key"));
    assert!(is_sensitive_relative_path("aws/credentials"));
    assert!(is_sensitive_relative_path("my-secret-token"));
    assert!(is_sensitive_relative_path(".netrc"));
    assert!(is_sensitive_relative_path(".npmrc"));
    assert!(is_sensitive_relative_path("certs/server.p12"));
    assert!(is_sensitive_relative_path(".kube/config"));
    assert!(is_sensitive_relative_path("id_ed25519"));
    assert!(!is_sensitive_relative_path("src/main.rs"));
    assert!(!is_sensitive_relative_path("README.md"));
}
