use app_lib::commands::fs::{
    build_hunks, fs_copy, fs_delete, fs_move, fs_rename, fs_write_file, is_sensitive_relative_path,
};
use std::fs;

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

#[test]
fn env_template_paths_are_not_sensitive() {
    for path in [
        ".env.example",
        ".env.sample",
        ".env.template",
        ".ENV.EXAMPLE",
        ".Env.Sample",
        "config/.env.example",
        "nested/dir/.env.template",
    ] {
        assert!(
            !is_sensitive_relative_path(path),
            "template path should be allowed: {path}"
        );
    }

    for path in [
        ".env",
        ".env.local",
        ".env.production",
        ".env.development",
        ".env.example.local",
        "config/.env.production",
    ] {
        assert!(
            is_sensitive_relative_path(path),
            "real env path should stay blocked: {path}"
        );
    }
}

#[test]
fn write_permits_env_templates_without_allow_sensitive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();

    fs_write_file(root.clone(), ".env.example".into(), "KEY=\n".into(), None)
        .expect("write .env.example");
    assert_eq!(
        fs::read_to_string(dir.path().join(".env.example")).expect("read .env.example"),
        "KEY=\n"
    );

    fs_write_file(root.clone(), ".env.sample".into(), "KEY=\n".into(), None)
        .expect("write .env.sample");
    fs_write_file(root, ".env.template".into(), "KEY=\n".into(), None)
        .expect("write .env.template");
}

#[test]
fn write_rename_delete_block_env_when_allow_sensitive_is_none() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();

    let write_err = fs_write_file(root.clone(), ".env".into(), "SECRET=1\n".into(), None)
        .expect_err("write .env should be blocked");
    assert_eq!(write_err, "Sensitive path blocked");

    let rename_err = fs_rename(root.clone(), ".env".into(), "env.bak".into(), None)
        .expect_err("rename .env should be blocked");
    assert_eq!(rename_err, "Sensitive path blocked");

    let delete_err =
        fs_delete(root, ".env".into(), None, None).expect_err("delete .env should be blocked");
    assert_eq!(delete_err, "Sensitive path blocked");
}

#[test]
fn write_rename_delete_permit_env_when_allow_sensitive_is_true() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();

    fs_write_file(root.clone(), ".env".into(), "SECRET=1\n".into(), Some(true))
        .expect("write .env with allow_sensitive");
    assert_eq!(
        fs::read_to_string(dir.path().join(".env")).expect("read .env"),
        "SECRET=1\n"
    );

    fs_rename(root.clone(), ".env".into(), "env.bak".into(), Some(true))
        .expect("rename .env with allow_sensitive");
    assert!(!dir.path().join(".env").exists());
    assert_eq!(
        fs::read_to_string(dir.path().join("env.bak")).expect("read env.bak"),
        "SECRET=1\n"
    );

    fs_write_file(root.clone(), ".env".into(), "SECRET=2\n".into(), Some(true))
        .expect("rewrite .env with allow_sensitive");
    fs_delete(root, ".env".into(), None, Some(true)).expect("delete .env with allow_sensitive");
    assert!(!dir.path().join(".env").exists());
}

#[test]
fn copy_move_block_env_when_allow_sensitive_is_none() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();

    let copy_source_err = fs_copy(root.clone(), ".env".into(), "env.bak".into(), None)
        .expect_err("copy .env should be blocked");
    assert_eq!(copy_source_err, "Sensitive path blocked");

    let move_source_err = fs_move(root.clone(), ".env".into(), "env.bak".into(), None)
        .expect_err("move .env should be blocked");
    assert_eq!(move_source_err, "Sensitive path blocked");

    fs::write(dir.path().join("notes.txt"), "hello\n").expect("write notes.txt");
    let copy_dest_err = fs_copy(root.clone(), "notes.txt".into(), ".env".into(), None)
        .expect_err("copy into .env should be blocked");
    assert_eq!(copy_dest_err, "Sensitive path blocked");

    let move_dest_err = fs_move(root, "notes.txt".into(), ".env".into(), None)
        .expect_err("move into .env should be blocked");
    assert_eq!(move_dest_err, "Sensitive path blocked");
}

#[test]
fn copy_move_permit_env_when_allow_sensitive_is_true() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();

    fs_write_file(root.clone(), ".env".into(), "SECRET=1\n".into(), Some(true))
        .expect("write .env with allow_sensitive");

    fs_copy(root.clone(), ".env".into(), "env.copy".into(), Some(true))
        .expect("copy .env with allow_sensitive");
    assert_eq!(
        fs::read_to_string(dir.path().join("env.copy")).expect("read env.copy"),
        "SECRET=1\n"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join(".env")).expect("read .env after copy"),
        "SECRET=1\n"
    );

    fs_move(root, ".env".into(), "env.moved".into(), Some(true))
        .expect("move .env with allow_sensitive");
    assert!(!dir.path().join(".env").exists());
    assert_eq!(
        fs::read_to_string(dir.path().join("env.moved")).expect("read env.moved"),
        "SECRET=1\n"
    );
}
