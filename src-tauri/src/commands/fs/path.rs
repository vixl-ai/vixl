use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Deserialize;

/// Canonical workspace member used by the multi-root path jail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRoot {
    pub slug: String,
    pub path: PathBuf,
}

/// IPC payload for an optional multi-root workspace (`projectRoots`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootArg {
    pub slug: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedWorkspacePath {
    pub slug: Option<String>,
    pub root: PathBuf,
    pub path: PathBuf,
}

impl ResolvedWorkspacePath {
    pub(crate) fn relative_of(&self, absolute: &Path) -> String {
        let rel = relative_path(&self.root, absolute);
        match &self.slug {
            Some(slug) if rel.is_empty() => slug.clone(),
            Some(slug) => format!("{slug}/{rel}"),
            None => rel,
        }
    }

    pub(crate) fn reported_path(&self) -> String {
        self.relative_of(&self.path)
    }

    /// Path relative to the resolved member root, without a slug prefix.
    pub(crate) fn member_relative_path(&self) -> String {
        relative_path(&self.root, &self.path)
    }
}

pub(crate) fn canonical_project_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root);
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("Invalid project root: {error}"))?;
    if !canonical.is_dir() {
        return Err("Project root is not a directory".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_workspace_path(
    project_root: &str,
    user_path: &str,
) -> Result<PathBuf, String> {
    let root = canonical_project_root(project_root)?;
    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let relative = Path::new(trimmed);
    if relative.is_absolute() {
        return Err("Path must be relative to the project root".to_string());
    }

    let mut joined = root.clone();
    for component in relative.components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("Path traversal is not allowed".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path component".to_string());
            }
        }
    }

    ensure_under_root(&root, &joined)
}

pub(crate) fn ensure_under_root(root: &Path, target: &Path) -> Result<PathBuf, String> {
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Failed to resolve path: {error}"))?;
        if !canonical.starts_with(root) {
            return Err("Path escapes project root".to_string());
        }
        return Ok(canonical);
    }

    let mut probe = target.to_path_buf();
    loop {
        if probe.exists() {
            let canonical = probe
                .canonicalize()
                .map_err(|error| format!("Failed to resolve path: {error}"))?;
            if !canonical.starts_with(root) {
                return Err("Path escapes project root".to_string());
            }
            return Ok(target.to_path_buf());
        }
        if !probe.pop() {
            break;
        }
    }

    if target.starts_with(root) {
        return Ok(target.to_path_buf());
    }

    Err("Path escapes project root".to_string())
}

pub(crate) fn workspace_roots_from_args(
    args: &[WorkspaceRootArg],
) -> Result<Vec<WorkspaceRoot>, String> {
    let mut roots = Vec::with_capacity(args.len());
    let mut seen = std::collections::HashSet::new();
    for arg in args {
        let slug = arg.slug.trim();
        if slug.is_empty() {
            return Err("Project slug is required".to_string());
        }
        if !is_valid_member_slug(slug) {
            return Err(format!("Invalid project slug: {slug}"));
        }
        if !seen.insert(slug.to_string()) {
            return Err(format!("Duplicate project slug: {slug}"));
        }
        roots.push(WorkspaceRoot {
            slug: slug.to_string(),
            path: canonical_project_root(&arg.path)?,
        });
    }
    Ok(roots)
}

fn is_valid_member_slug(slug: &str) -> bool {
    if slug == "." || slug == ".." {
        return false;
    }
    !slug.contains('/') && !slug.contains('\\') && !slug.contains('\0')
}

fn format_valid_slugs(roots: &[WorkspaceRoot]) -> String {
    roots
        .iter()
        .map(|root| root.slug.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn reject_parent_dir_components(path: &Path) -> Result<(), String> {
    for component in path.components() {
        match component {
            Component::ParentDir => return Err("Path traversal is not allowed".to_string()),
            Component::Prefix(_) => return Err("Invalid path component".to_string()),
            _ => {}
        }
    }
    Ok(())
}

fn join_under_member(root: &WorkspaceRoot, relative: &Path) -> Result<PathBuf, String> {
    let mut joined = root.path.clone();
    for component in relative.components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("Path traversal is not allowed".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path component".to_string());
            }
        }
    }
    ensure_under_root(&root.path, &joined)
}

fn first_normal_segment(path: &Path) -> Option<String> {
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => return Some(part.to_string_lossy().to_string()),
            _ => return None,
        }
    }
    None
}

fn remainder_after_first_normal(path: &Path) -> PathBuf {
    let mut seen_first = false;
    let mut rest = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {
                if seen_first {
                    rest.push(".");
                }
            }
            Component::Normal(part) => {
                if seen_first {
                    rest.push(part);
                } else {
                    seen_first = true;
                }
            }
            Component::ParentDir => rest.push(".."),
            Component::RootDir | Component::Prefix(_) => {}
        }
    }
    rest
}

fn resolve_absolute_against_roots(
    roots: &[WorkspaceRoot],
    user_path: &Path,
) -> Result<(String, PathBuf), String> {
    reject_parent_dir_components(user_path)?;

    let mut matches = Vec::new();
    for root in roots {
        if let Ok(canonical) = ensure_under_root(&root.path, user_path) {
            matches.push((root.slug.clone(), root.path.clone(), canonical));
        }
    }

    if matches.is_empty() {
        return Err("Absolute path is outside all project roots".to_string());
    }

    matches.sort_by_key(|(_, root_path, _)| std::cmp::Reverse(root_path.as_os_str().len()));
    let (slug, _, canonical) = matches.remove(0);
    Ok((slug, canonical))
}

/// Resolve `user_path` against one or more canonical workspace members.
///
/// A leading segment matching a member slug selects that root. Unprefixed
/// relative paths are allowed only when exactly one root is present. Absolute
/// paths are accepted only when their canonical form sits inside a member.
pub(crate) fn resolve_multi_root_path(
    roots: &[WorkspaceRoot],
    user_path: &str,
) -> Result<(String, PathBuf), String> {
    if roots.is_empty() {
        return Err("At least one workspace root is required".to_string());
    }

    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let input = Path::new(trimmed);
    if input.is_absolute() {
        return resolve_absolute_against_roots(roots, input);
    }

    reject_parent_dir_components(input)?;

    if let Some(segment) = first_normal_segment(input) {
        if let Some(member) = roots.iter().find(|root| root.slug == segment) {
            let rest = remainder_after_first_normal(input);
            let canonical = join_under_member(member, &rest)?;
            return Ok((member.slug.clone(), canonical));
        }
    }

    if roots.len() == 1 {
        let canonical = join_under_member(&roots[0], input)?;
        return Ok((roots[0].slug.clone(), canonical));
    }

    Err(format!(
        "Path must be prefixed with a project slug. Valid slugs: {}",
        format_valid_slugs(roots)
    ))
}

pub(crate) fn resolve_command_path(
    project_root: &str,
    project_roots: Option<&[WorkspaceRootArg]>,
    user_path: &str,
) -> Result<ResolvedWorkspacePath, String> {
    if let Some(args) = project_roots.filter(|roots| !roots.is_empty()) {
        let roots = workspace_roots_from_args(args)?;
        let (slug, path) = resolve_multi_root_path(&roots, user_path)?;
        let member = roots
            .iter()
            .find(|root| root.slug == slug)
            .ok_or_else(|| "Resolved path is missing its project root".to_string())?;
        return Ok(ResolvedWorkspacePath {
            slug: Some(slug),
            root: member.path.clone(),
            path,
        });
    }

    let root = canonical_project_root(project_root)?;
    let path = resolve_workspace_path(project_root, user_path)?;
    Ok(ResolvedWorkspacePath {
        slug: None,
        root,
        path,
    })
}

pub fn is_sensitive_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();

    for segment in lower.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if is_sensitive_env_segment(segment) {
            return true;
        }
        if matches!(
            segment,
            ".ssh"
                | ".aws"
                | ".gnupg"
                | ".netrc"
                | ".npmrc"
                | ".pypirc"
                | "id_rsa"
                | "id_dsa"
                | "id_ecdsa"
                | "id_ed25519"
                | "credentials"
                | "credentials.json"
                | "secrets.json"
        ) {
            return true;
        }
        if segment.ends_with(".pem")
            || segment.ends_with(".key")
            || segment.ends_with(".p12")
            || segment.ends_with(".pfx")
            || segment.ends_with(".jks")
        {
            return true;
        }
        if segment.contains("credential")
            || segment.contains("secret")
            || segment.contains("password")
        {
            return true;
        }
    }

    // Well-known secret file paths (segment-aware checks above miss nested config names).
    if lower.ends_with("/.docker/config.json")
        || lower == ".docker/config.json"
        || lower.ends_with("/kube/config")
        || lower.ends_with("/.kube/config")
        || lower == ".kube/config"
    {
        return true;
    }

    false
}

fn is_sensitive_env_segment(segment: &str) -> bool {
    if matches!(segment, ".env.example" | ".env.sample" | ".env.template") {
        return false;
    }
    segment == ".env" || segment.starts_with(".env.")
}

pub(crate) fn reject_sensitive_path(user_path: &str) -> Result<(), String> {
    if is_sensitive_relative_path(user_path) {
        return Err("Sensitive path blocked".to_string());
    }
    Ok(())
}

pub(crate) fn reject_sensitive_path_unless_allowed(
    user_path: &str,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    if allow_sensitive.unwrap_or(false) {
        return Ok(());
    }
    reject_sensitive_path(user_path)
}

pub(crate) fn reject_resolved_sensitive_path(
    resolved: &ResolvedWorkspacePath,
) -> Result<(), String> {
    reject_sensitive_path(&resolved.member_relative_path())
}

pub(crate) fn reject_resolved_sensitive_path_unless_allowed(
    resolved: &ResolvedWorkspacePath,
    allow_sensitive: Option<bool>,
) -> Result<(), String> {
    reject_sensitive_path_unless_allowed(&resolved.member_relative_path(), allow_sensitive)
}

pub(crate) fn relative_path(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| absolute.to_string_lossy().to_string())
}

pub(crate) fn entry_kind(path: &Path) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        Ok("directory".to_string())
    } else if meta.is_file() {
        Ok("file".to_string())
    } else if meta.file_type().is_symlink() {
        Ok("symlink".to_string())
    } else {
        Ok("other".to_string())
    }
}

pub(crate) fn modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_member(slug: &str) -> (tempfile::TempDir, WorkspaceRoot) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().canonicalize().expect("canonical member");
        (
            dir,
            WorkspaceRoot {
                slug: slug.to_string(),
                path,
            },
        )
    }

    fn write_file(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    #[test]
    fn slug_prefix_selects_member() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        write_file(&api.path, "src/foo.ts", "api");
        write_file(&web.path, "src/foo.ts", "web");

        let (slug, resolved) =
            resolve_multi_root_path(&[api.clone(), web.clone()], "api/src/foo.ts")
                .expect("prefixed path");
        assert_eq!(slug, "api");
        assert_eq!(
            resolved,
            api.path.join("src/foo.ts").canonicalize().expect("file")
        );

        let _keep = (api_dir, web_dir);
    }

    #[test]
    fn unprefixed_rejected_when_multiple_roots() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        write_file(&api.path, "src/foo.ts", "api");

        let error = resolve_multi_root_path(&[api, web], "src/foo.ts")
            .expect_err("unprefixed path with multiple roots");
        assert!(
            error.contains("api") && error.contains("web"),
            "error should list valid slugs: {error}"
        );
        assert!(
            error.contains("prefixed with a project slug"),
            "error should explain prefix requirement: {error}"
        );

        let _keep = (api_dir, web_dir);
    }

    #[test]
    fn single_root_allows_unprefixed() {
        let (api_dir, api) = temp_member("api");
        write_file(&api.path, "src/foo.ts", "api");

        let (slug, resolved) =
            resolve_multi_root_path(&[api.clone()], "src/foo.ts").expect("unprefixed single root");
        assert_eq!(slug, "api");
        assert_eq!(
            resolved,
            api.path.join("src/foo.ts").canonicalize().expect("file")
        );

        let _keep = api_dir;
    }

    #[test]
    fn absolute_inside_member_is_accepted() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        write_file(&api.path, "src/foo.ts", "api");
        let absolute = api.path.join("src/foo.ts");

        let (slug, resolved) = resolve_multi_root_path(
            &[api.clone(), web],
            &absolute.to_string_lossy(),
        )
        .expect("absolute in root");
        assert_eq!(slug, "api");
        assert_eq!(resolved, absolute.canonicalize().expect("file"));

        let _keep = (api_dir, web_dir);
    }

    #[test]
    fn absolute_outside_all_roots_is_rejected() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        let outside = tempfile::tempdir().expect("outside");
        let file = outside.path().join("secret.txt");
        fs::write(&file, "nope").expect("write outside");

        let error = resolve_multi_root_path(&[api, web], &file.to_string_lossy())
            .expect_err("absolute outside");
        assert!(
            error.contains("outside all project roots"),
            "got: {error}"
        );

        let _keep = (api_dir, web_dir, outside);
    }

    #[test]
    fn parent_dir_traversal_is_rejected() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");

        let error = resolve_multi_root_path(&[api, web], "api/../web/src/foo.ts")
            .expect_err("parent traversal");
        assert_eq!(error, "Path traversal is not allowed");

        let _keep = (api_dir, web_dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        let outside = tempfile::tempdir().expect("outside");
        let secret = outside.path().join("secret.txt");
        fs::write(&secret, "nope").expect("write secret");

        let link = api.path.join("escape");
        std::os::unix::fs::symlink(outside.path(), &link).expect("symlink");

        let error = resolve_multi_root_path(&[api, web], "api/escape/secret.txt")
            .expect_err("symlink escape");
        assert_eq!(error, "Path escapes project root");

        let _keep = (api_dir, web_dir, outside);
    }

    #[test]
    fn command_path_keeps_single_root_behavior() {
        let (api_dir, api) = temp_member("api");
        write_file(&api.path, "src/foo.ts", "api");
        let resolved = resolve_command_path(&api.path.to_string_lossy(), None, "src/foo.ts")
            .expect("single root command path");
        assert_eq!(resolved.slug, None);
        assert_eq!(resolved.reported_path(), "src/foo.ts");
        let _keep = api_dir;
    }

    fn member_args(slug: &str, root: &Path) -> Vec<WorkspaceRootArg> {
        vec![WorkspaceRootArg {
            slug: slug.to_string(),
            path: root.to_string_lossy().to_string(),
        }]
    }

    #[test]
    fn credentials_slug_does_not_block_ordinary_member_file() {
        let (dir, member) = temp_member("credentials");
        write_file(&member.path, "src/index.ts", "export {}\n");
        let args = member_args("credentials", &member.path);
        let resolved = resolve_command_path(
            &member.path.to_string_lossy(),
            Some(&args),
            "credentials/src/index.ts",
        )
        .expect("resolve credentials member file");
        assert_eq!(resolved.member_relative_path(), "src/index.ts");
        reject_resolved_sensitive_path(&resolved).expect("slug must not mark file sensitive");
        let _keep = dir;
    }

    #[test]
    fn member_relative_sensitive_paths_are_rejected() {
        let (api_dir, api) = temp_member("api");
        let (web_dir, web) = temp_member("web");
        write_file(&api.path, ".env", "SECRET=1\n");
        write_file(&api.path, "secrets/key.pem", "pem\n");
        let args = vec![
            WorkspaceRootArg {
                slug: "api".to_string(),
                path: api.path.to_string_lossy().to_string(),
            },
            WorkspaceRootArg {
                slug: "web".to_string(),
                path: web.path.to_string_lossy().to_string(),
            },
        ];

        let env_resolved = resolve_command_path(
            &api.path.to_string_lossy(),
            Some(&args),
            "api/.env",
        )
        .expect("resolve env");
        let env_err = reject_resolved_sensitive_path(&env_resolved).expect_err("env blocked");
        assert_eq!(env_err, "Sensitive path blocked");

        let pem_resolved = resolve_command_path(
            &api.path.to_string_lossy(),
            Some(&args),
            "api/secrets/key.pem",
        )
        .expect("resolve pem");
        let pem_err = reject_resolved_sensitive_path(&pem_resolved).expect_err("pem blocked");
        assert_eq!(pem_err, "Sensitive path blocked");

        let _keep = (api_dir, web_dir);
    }

    #[test]
    fn single_root_sensitive_check_still_uses_relative_path() {
        let (dir, member) = temp_member("api");
        write_file(&member.path, ".env", "SECRET=1\n");
        let resolved = resolve_command_path(&member.path.to_string_lossy(), None, ".env")
            .expect("single root env");
        assert_eq!(resolved.member_relative_path(), ".env");
        let err = reject_resolved_sensitive_path(&resolved).expect_err("single root env blocked");
        assert_eq!(err, "Sensitive path blocked");
        let _keep = dir;
    }
}
