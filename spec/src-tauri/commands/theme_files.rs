use std::fs;
use std::path::PathBuf;

use app_lib::commands::theme_files::{read_theme_file, write_theme_file, MAX_THEME_FILE_BYTES};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vixl-theme-files-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn read_theme_file_returns_content_and_size() {
    let dir = temp_dir("read-ok");
    let path = dir.join("theme.vixl-theme.json");
    fs::write(&path, r#"{"format":"vixl-theme","version":1}"#).unwrap();

    let content = read_theme_file(path.to_string_lossy().to_string()).expect("read ok");
    assert!(content.content.contains("vixl-theme"));
    assert_eq!(content.size_bytes, content.content.len());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_theme_file_rejects_parent_dir_traversal() {
    let error = read_theme_file("../etc/passwd".to_string()).expect_err("traversal rejected");
    assert!(error.contains("traversal"));
}

#[test]
fn read_theme_file_rejects_missing_files() {
    let dir = temp_dir("read-missing");
    let error = read_theme_file(dir.join("nope.json").to_string_lossy().to_string())
        .expect_err("missing file rejected");
    assert!(error.contains("Failed to read theme file"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_theme_file_enforces_pre_parse_size_cap() {
    let dir = temp_dir("read-oversize");
    let path = dir.join("big.vixl-theme.json");
    let oversized = "x".repeat((MAX_THEME_FILE_BYTES + 1) as usize);
    fs::write(&path, &oversized).unwrap();

    let error = read_theme_file(path.to_string_lossy().to_string()).expect_err("oversize rejected");
    assert!(error.contains("too large"));
    assert!(error.contains(&MAX_THEME_FILE_BYTES.to_string()));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_theme_file_writes_valid_json_atomically() {
    let dir = temp_dir("write-ok");
    let path = dir.join("out.vixl-theme.json");
    let payload = r#"{"format":"vixl-theme","version":1,"id":"sunset"}"#;

    write_theme_file(path.to_string_lossy().to_string(), payload.to_string()).expect("write ok");

    let written = fs::read_to_string(&path).expect("file exists after write");
    assert_eq!(written, payload);
    // No temp artifacts left behind by the atomic write.
    let leftovers: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_theme_file_rejects_non_json_content() {
    let dir = temp_dir("write-nonjson");
    let path = dir.join("bad.vixl-theme.json");

    let error = write_theme_file(
        path.to_string_lossy().to_string(),
        "not json at all".to_string(),
    )
    .expect_err("non-JSON rejected");
    assert!(error.contains("not valid JSON"));
    assert!(!path.exists(), "no file written for invalid content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_theme_file_rejects_oversize_content() {
    let dir = temp_dir("write-oversize");
    let path = dir.join("big.vixl-theme.json");
    let oversized = format!("\"{}\"", "x".repeat((MAX_THEME_FILE_BYTES + 1) as usize));

    let error = write_theme_file(path.to_string_lossy().to_string(), oversized)
        .expect_err("oversize rejected");
    assert!(error.contains("too large"));
    assert!(!path.exists(), "no file written for oversize content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_theme_file_rejects_parent_dir_traversal() {
    let error = write_theme_file(
        "../escape.vixl-theme.json".to_string(),
        "{}".to_string(),
    )
    .expect_err("traversal rejected");
    assert!(error.contains("traversal"));
}
