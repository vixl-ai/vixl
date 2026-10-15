use std::fs;
use std::path::Path;

use app_lib::commands::search::{workspace_glob, WorkspaceGlobRequest};

fn write_file(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, contents).expect("write file");
}

fn temp_git_project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    fs::create_dir(root.join(".git")).expect("create .git");
    write_file(root, ".gitignore", "ignored.rs\nbuild/\n");
    write_file(root, "src/main.rs", "fn main() {}\n");
    write_file(root, "src/foo.rs", "pub fn foo() {}\n");
    write_file(root, "src/lib.ts", "export {}\n");
    write_file(root, "src/myfoo_mod.rs", "pub fn myfoo() {}\n");
    write_file(root, "ignored.rs", "should be ignored\n");
    write_file(root, ".hidden.rs", "hidden\n");
    write_file(root, "build/out.rs", "generated\n");
    dir
}

fn glob(
    root: &Path,
    pattern: &str,
    limit: Option<u32>,
) -> app_lib::commands::search::WorkspaceGlobResult {
    let request = WorkspaceGlobRequest {
        project_root: root.to_string_lossy().to_string(),
        pattern: pattern.to_string(),
        limit,
        project_roots: None,
    };
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(workspace_glob(request))
        .expect("workspace_glob")
}

#[test]
fn matches_recursive_extension_pattern() {
    let project = temp_git_project();
    let result = glob(project.path(), "**/*.rs", None);
    let paths: Vec<_> = result
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();

    assert!(!result.truncated);
    assert!(paths.contains(&"src/main.rs"));
    assert!(paths.contains(&"src/foo.rs"));
    assert!(paths.contains(&"src/myfoo_mod.rs"));
    assert!(!paths.iter().any(|path| path.ends_with(".ts")));
}

#[test]
fn matches_basename_pattern_without_slash() {
    let project = temp_git_project();
    let result = glob(project.path(), "*foo*", None);
    let paths: Vec<_> = result
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();

    assert!(paths.contains(&"src/foo.rs"));
    assert!(paths.contains(&"src/myfoo_mod.rs"));
    assert!(!paths.contains(&"src/main.rs"));
}

#[test]
fn excludes_hidden_and_gitignored_files() {
    let project = temp_git_project();
    let result = glob(project.path(), "**/*", None);
    let paths: Vec<_> = result
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect();

    assert!(!paths.contains(&"ignored.rs"));
    assert!(!paths.contains(&".hidden.rs"));
    assert!(!paths.contains(&"build/out.rs"));
    assert!(!paths.iter().any(|path| path.starts_with(".git/")));
}

#[test]
fn truncates_when_over_limit() {
    let project = temp_git_project();
    let result = glob(project.path(), "**/*.rs", Some(1));

    assert!(result.truncated);
    assert_eq!(result.files.len(), 1);
}

#[test]
fn empty_pattern_is_required_error() {
    let project = temp_git_project();
    let request = WorkspaceGlobRequest {
        project_root: project.path().to_string_lossy().to_string(),
        pattern: "   ".to_string(),
        limit: None,
        project_roots: None,
    };
    let error = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(workspace_glob(request))
        .expect_err("empty pattern");

    assert_eq!(error, "Glob pattern is required");
}

#[test]
fn results_are_sorted_by_path() {
    let project = temp_git_project();
    let result = glob(project.path(), "**/*.rs", None);
    let paths: Vec<_> = result
        .files
        .iter()
        .map(|entry| entry.path.clone())
        .collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);
}
