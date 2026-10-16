use std::fs;
use std::path::Path;

use app_lib::commands::fs::WorkspaceRootArg;
use app_lib::commands::search::{workspace_glob, WorkspaceGlobRequest, WorkspaceGlobResult};

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

fn member_root(slug: &str, path: &Path) -> WorkspaceRootArg {
    WorkspaceRootArg {
        slug: slug.to_string(),
        path: path.to_string_lossy().to_string(),
    }
}

fn glob_paths(result: &WorkspaceGlobResult) -> Vec<&str> {
    result
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect()
}

fn glob_with_roots(
    project_root: &Path,
    roots: Vec<WorkspaceRootArg>,
    pattern: &str,
) -> WorkspaceGlobResult {
    let request = WorkspaceGlobRequest {
        project_root: project_root.to_string_lossy().to_string(),
        pattern: pattern.to_string(),
        limit: None,
        project_roots: Some(roots),
    };
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(workspace_glob(request))
        .expect("workspace_glob")
}

fn temp_workspace_members() -> (tempfile::TempDir, tempfile::TempDir) {
    let empty_space = temp_git_project();
    write_file(empty_space.path(), "lib/foo.ts", "export const foo = 1;\n");
    write_file(
        empty_space.path(),
        "lib/nested/bar.ts",
        "export const bar = 2;\n",
    );

    let web = tempfile::tempdir().expect("tempdir");
    fs::create_dir(web.path().join(".git")).expect("create .git");
    write_file(web.path(), "lib/client.ts", "export const client = 1;\n");
    write_file(web.path(), "src/app.ts", "export const app = 1;\n");

    (empty_space, web)
}

fn workspace_roots(empty_space: &Path, web: &Path) -> Vec<WorkspaceRootArg> {
    vec![
        member_root("empty-space", empty_space),
        member_root("web", web),
    ]
}

#[test]
fn slug_prefixed_lib_glob_returns_that_member() {
    let (empty_space, web) = temp_workspace_members();
    let result = glob_with_roots(
        empty_space.path(),
        workspace_roots(empty_space.path(), web.path()),
        "empty-space/lib/**/*.ts",
    );
    let paths = glob_paths(&result);

    assert!(!result.truncated);
    assert!(paths.contains(&"empty-space/lib/foo.ts"));
    assert!(paths.contains(&"empty-space/lib/nested/bar.ts"));
    assert!(!paths.iter().any(|path| path.starts_with("web/")));
    assert!(!paths.contains(&"empty-space/src/lib.ts"));
}

#[test]
fn slug_prefixed_recursive_ts_glob_returns_that_member() {
    let (empty_space, web) = temp_workspace_members();
    let result = glob_with_roots(
        empty_space.path(),
        workspace_roots(empty_space.path(), web.path()),
        "empty-space/**/*.ts",
    );
    let paths = glob_paths(&result);

    assert!(paths.contains(&"empty-space/lib/foo.ts"));
    assert!(paths.contains(&"empty-space/lib/nested/bar.ts"));
    assert!(paths.contains(&"empty-space/src/lib.ts"));
    assert!(!paths.iter().any(|path| path.starts_with("web/")));
}

#[test]
fn bare_slug_glob_lists_that_member() {
    let (empty_space, web) = temp_workspace_members();
    let result = glob_with_roots(
        empty_space.path(),
        workspace_roots(empty_space.path(), web.path()),
        "empty-space",
    );
    let paths = glob_paths(&result);

    assert!(paths.contains(&"empty-space/lib/foo.ts"));
    assert!(paths.contains(&"empty-space/src/main.rs"));
    assert!(paths.contains(&"empty-space/src/lib.ts"));
    assert!(!paths.iter().any(|path| path.starts_with("web/")));
}

#[test]
fn unprefixed_glob_fans_out_across_members() {
    let (empty_space, web) = temp_workspace_members();
    let result = glob_with_roots(
        empty_space.path(),
        workspace_roots(empty_space.path(), web.path()),
        "lib/**/*.ts",
    );
    let paths = glob_paths(&result);

    assert!(paths.contains(&"empty-space/lib/foo.ts"));
    assert!(paths.contains(&"empty-space/lib/nested/bar.ts"));
    assert!(paths.contains(&"web/lib/client.ts"));
    assert!(!paths.contains(&"web/src/app.ts"));
}

#[test]
fn unknown_slug_glob_prefix_is_literal_and_matches_nothing() {
    let (empty_space, web) = temp_workspace_members();
    let result = glob_with_roots(
        empty_space.path(),
        workspace_roots(empty_space.path(), web.path()),
        "unknown/lib/**/*.ts",
    );

    assert!(result.files.is_empty());
    assert!(!result.truncated);
}
