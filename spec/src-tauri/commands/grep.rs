use std::fs;
use std::path::Path;

use app_lib::commands::search::{workspace_grep, WorkspaceGrepRequest, WorkspaceGrepResult};

fn write_file(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, contents).expect("write file");
}

fn write_bytes(root: &Path, relative: &str, contents: &[u8]) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, contents).expect("write bytes");
}

fn temp_git_project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    fs::create_dir(root.join(".git")).expect("create .git");
    write_file(root, ".gitignore", "ignored.rs\nbuild/\n");
    write_file(root, "src/main.rs", "fn main() {\n    let foo = 1;\n}\n");
    write_file(root, "src/lib.ts", "export const foo = 1;\n");
    write_file(root, "src/nested/util.rs", "pub fn helper() {}\n");
    write_file(root, "notes.txt", "foo. bar food\n");
    write_file(root, "ignored.rs", "let foo = \"ignored\";\n");
    write_file(root, ".hidden.rs", "let foo = \"hidden\";\n");
    write_file(root, "build/out.rs", "let foo = \"generated\";\n");
    write_bytes(root, "blob.bin", b"\x00foo secret\n");
    dir
}

fn grep(request: WorkspaceGrepRequest) -> Result<WorkspaceGrepResult, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(workspace_grep(request))
}

fn request(root: &Path, pattern: &str) -> WorkspaceGrepRequest {
    WorkspaceGrepRequest {
        project_root: root.to_string_lossy().to_string(),
        pattern: pattern.to_string(),
        path: None,
        glob: None,
        case_insensitive: None,
        max_results: None,
        regex: None,
        whole_word: None,
        exclude_glob: None,
        project_roots: None,
    }
}

#[test]
fn matches_regex_with_line_and_columns() {
    let project = temp_git_project();
    let result = grep(request(project.path(), "foo")).expect("workspace_grep");
    let found = result
        .matches
        .iter()
        .find(|item| item.path == "src/main.rs")
        .expect("main.rs match");

    assert!(!result.truncated);
    assert_eq!(found.line_number, 2);
    assert_eq!(found.line, "    let foo = 1;");
    assert_eq!(found.start_column, Some(9));
    assert_eq!(found.end_column, Some(12));
}

#[test]
fn fixed_strings_does_not_interpret_regex() {
    let project = temp_git_project();
    let mut req = request(project.path(), "foo.");
    req.regex = Some(false);
    let result = grep(req).expect("workspace_grep");
    let paths: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.path.as_str())
        .collect();

    assert!(paths.contains(&"notes.txt"));
    assert!(!paths.contains(&"src/main.rs"));
}

#[test]
fn whole_word_skips_partial_tokens() {
    let project = temp_git_project();
    let mut req = request(project.path(), "foo");
    req.whole_word = Some(true);
    req.glob = Some("notes.txt".to_string());
    let result = grep(req).expect("workspace_grep");

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].line, "foo. bar food");
    assert_eq!(result.matches[0].start_column, Some(1));
    assert_eq!(result.matches[0].end_column, Some(4));
}

#[test]
fn case_insensitive_matches() {
    let project = temp_git_project();
    let mut req = request(project.path(), "FOO");
    req.case_insensitive = Some(true);
    req.glob = Some("src/main.rs".to_string());
    let result = grep(req).expect("workspace_grep");

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].path, "src/main.rs");
}

#[test]
fn include_glob_limits_files() {
    let project = temp_git_project();
    let mut req = request(project.path(), "foo");
    req.glob = Some("**/*.rs".to_string());
    let result = grep(req).expect("workspace_grep");
    let paths: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.path.as_str())
        .collect();

    assert!(paths.contains(&"src/main.rs"));
    assert!(!paths.contains(&"src/lib.ts"));
    assert!(!paths.contains(&"notes.txt"));
}

#[test]
fn exclude_glob_skips_files() {
    let project = temp_git_project();
    let mut req = request(project.path(), "foo");
    req.exclude_glob = Some("**/*.ts".to_string());
    let result = grep(req).expect("workspace_grep");
    let paths: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.path.as_str())
        .collect();

    assert!(paths.contains(&"src/main.rs"));
    assert!(!paths.contains(&"src/lib.ts"));
}

#[test]
fn path_scopes_to_subdir_with_root_relative_results() {
    let project = temp_git_project();
    let mut req = request(project.path(), "helper");
    req.path = Some("src/nested".to_string());
    let result = grep(req).expect("workspace_grep");

    assert_eq!(result.matches.len(), 1);
    assert_eq!(result.matches[0].path, "src/nested/util.rs");
}

#[test]
fn max_results_truncates() {
    let project = temp_git_project();
    let mut req = request(project.path(), "foo");
    req.max_results = Some(1);
    let result = grep(req).expect("workspace_grep");

    assert!(result.truncated);
    assert_eq!(result.matches.len(), 1);
}

#[test]
fn excludes_gitignored_and_hidden_files() {
    let project = temp_git_project();
    let result = grep(request(project.path(), "foo")).expect("workspace_grep");
    let paths: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.path.as_str())
        .collect();

    assert!(!paths.contains(&"ignored.rs"));
    assert!(!paths.contains(&".hidden.rs"));
    assert!(!paths.contains(&"build/out.rs"));
    assert!(!paths.iter().any(|path| path.starts_with(".git/")));
}

#[test]
fn skips_binary_files() {
    let project = temp_git_project();
    let mut req = request(project.path(), "secret");
    req.glob = Some("blob.bin".to_string());
    let result = grep(req).expect("workspace_grep");

    assert!(result.matches.is_empty());
}

#[test]
fn empty_pattern_is_required_error() {
    let project = temp_git_project();
    let error = grep(request(project.path(), "   ")).expect_err("empty pattern");
    assert_eq!(error, "Search pattern is required");
}

#[test]
fn invalid_regex_returns_error() {
    let project = temp_git_project();
    let error = grep(request(project.path(), "[")).expect_err("invalid regex");
    assert!(!error.is_empty());
}
