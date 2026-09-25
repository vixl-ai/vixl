use std::path::PathBuf;

use super::env::project_root_from_scope;
use crate::commands::fs::canonical_project_root;

/// Resolve the working directory for a stdio MCP child process.
///
/// Personal scopes (`None`, empty, whitespace-only, and `"personal"`) return
/// `Ok(None)` and the child inherits the app process cwd. That check is
/// `project_root_from_scope` in `env.rs`, so do not reimplement it here.
///
/// Any other scope key is a project root, including CodeGraph, whose scope
/// key is also that project's root. Relative scopes are rejected before
/// `canonical_project_root` so they are never resolved against the app
/// process cwd. An existing directory resolves to the `dunce`-simplified
/// canonical root so the child never sees a `\\?\` extended path on Windows.
pub(crate) fn mcp_stdio_working_dir(scope_key: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(root) = project_root_from_scope(scope_key) else {
        return Ok(None);
    };
    if !std::path::Path::new(root).is_absolute() {
        return Err(format!(
            "Invalid project root: '{root}' must be an absolute path to the project folder"
        ));
    }
    let canonical = canonical_project_root(root)?;
    Ok(Some(dunce::simplified(&canonical).to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personal_or_missing_scope_has_no_working_dir() {
        for scope in [None, Some(""), Some("   "), Some("personal")] {
            let cwd = mcp_stdio_working_dir(scope).expect("personal scope resolves");
            assert!(cwd.is_none(), "scope {scope:?} must not set a cwd");
        }
    }

    #[test]
    fn project_scope_resolves_to_canonical_root() {
        let dir = tempfile::tempdir().expect("temp dir");
        let scope = dir.path().to_str().expect("utf8 temp path");
        let cwd = mcp_stdio_working_dir(Some(scope)).expect("project scope resolves");
        let expected = dunce::canonicalize(dir.path()).expect("canonical temp path");
        assert_eq!(cwd, Some(expected));
    }

    #[test]
    fn relative_scope_rejects_without_resolving_against_cwd() {
        let err = mcp_stdio_working_dir(Some("server/mcp"))
            .expect_err("relative scope must fail before spawn");
        assert!(err.contains("Invalid project root"), "got: {err}");
        assert!(err.contains("absolute"), "got: {err}");
    }

    #[test]
    fn whitespace_around_root_still_resolves() {
        let dir = tempfile::tempdir().expect("temp dir");
        let scope = format!("  {}  ", dir.path().to_str().expect("utf8 temp path"));
        let cwd = mcp_stdio_working_dir(Some(&scope)).expect("whitespace scope resolves");
        let expected = dunce::canonicalize(dir.path()).expect("canonical temp path");
        assert_eq!(cwd, Some(expected));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_root_resolves_to_target() {
        let dir = tempfile::tempdir().expect("temp dir");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(dir.path(), &link).expect("create symlink");
        let cwd = mcp_stdio_working_dir(Some(link.to_str().expect("utf8 link path")))
            .expect("symlinked scope resolves");
        let expected = dunce::canonicalize(dir.path()).expect("canonical temp path");
        assert_eq!(cwd, Some(expected));
        assert_ne!(cwd, Some(link.clone()));
    }

    #[test]
    fn missing_project_root_errors() {
        let err = mcp_stdio_working_dir(Some("/no/such/vixl-mcp-project-root"))
            .expect_err("missing root must fail before spawn");
        assert!(err.contains("Invalid project root"));
    }

    #[test]
    fn file_project_root_errors_as_not_a_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("not-a-directory.txt");
        std::fs::write(&file, "x").expect("write file");
        let err = mcp_stdio_working_dir(Some(file.to_str().expect("utf8 file path")))
            .expect_err("file root must fail before spawn");
        assert!(err.contains("not a directory"));
    }
}
