/// Generate a macOS Seatbelt profile for agent shell sandbox execution.
///
/// Best-effort process isolation for the agent `run_terminal` path only (not MCP,
/// LSP, or the Tauri host). The profile uses parameter references substituted at
/// runtime by sandbox-exec via `-D KEY=VALUE` flags:
///   - `HOME`         - the user home directory
///   - `PROJECT_ROOT` - the project root (no trailing slash)
///   - `TMPDIR`       - the real (canonicalized) temp directory
///
/// Ancestor directories of `home` and `project_root` are emitted as literal
/// file-read allows so Node/npm `realpath`/`lstat` walks do not hit EPERM.
///
/// `project_writable` defaults to true via [`generate_seatbelt_profile`]. When
/// false, PROJECT_ROOT stays readable and TMPDIR/caches stay writable, but the
/// profile omits the project write allow (and the .env template write allow).
pub fn generate_seatbelt_profile(allow_network: bool, home: &str, project_root: &str) -> String {
    generate_seatbelt_profile_with(allow_network, true, home, project_root)
}

pub fn generate_seatbelt_profile_with(
    allow_network: bool,
    project_writable: bool,
    home: &str,
    project_root: &str,
) -> String {
    let ancestor_rules = format_ancestor_read_rules(home, project_root);
    let project_write_rules = if project_writable {
        r#"
; Project root: full read/write access
(allow file-read*  (subpath (param "PROJECT_ROOT")))
(allow file-write* (subpath (param "PROJECT_ROOT")))

; Deny writes to .git/hooks to prevent hook injection attacks
(deny file-write* (subpath (string-append (param "PROJECT_ROOT") "/.git/hooks")))

; Deny writes to .env and .env.* so the shell cannot bypass file-tool sensitive-path checks.
; require-all keeps the regex scoped to PROJECT_ROOT without interpolating it into the pattern.
; Later rules win: re-allow the same env templates that file tools permit.
(deny file-write*
  (require-all
    (subpath (param "PROJECT_ROOT"))
    (regex #"/\.env(\.[^/]*)?$")))
(allow file-write*
  (require-all
    (subpath (param "PROJECT_ROOT"))
    (regex #"/\.env\.(example|sample|template)$")))
"#
    } else {
        r#"
; Project root: read-only (TMPDIR and tool caches stay writable)
(allow file-read*  (subpath (param "PROJECT_ROOT")))
"#
    };

    render_seatbelt_profile(allow_network, &ancestor_rules, &project_write_rules)
}

fn render_seatbelt_profile(
    allow_network: bool,
    ancestor_rules: &str,
    project_write_rules: &str,
) -> String {
    let network_rule = if allow_network {
        "(allow network*)\n"
    } else {
        ""
    };

    format!(
        r##"(version 1)
(deny default)

; Process and signal operations required for shell execution
(allow process-exec)
(allow process-fork)
(allow process-exec-interpreter)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)

; System read paths: binaries, libraries, and frameworks
; Modern macOS process startup needs root-directory read; subpath allows alone are insufficient.
(allow file-read* (literal "/"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/sbin"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/Applications"))
(allow file-read* (subpath "/private/etc"))
(allow file-read* (subpath "/private/var/db/dyld"))
(allow file-read* (subpath "/private/var/folders"))
(allow file-read* (subpath "/private/var/select"))
; macOS symlink targets (var -> /private/var, etc -> /private/etc, tmp -> /private/tmp)
; Tools like cc/xcrun/xcode-select read /var/select/developer_dir; allow the symlink itself.
(allow file-read* (literal "/var"))
(allow file-read* (literal "/private/var"))
(allow file-read* (literal "/private"))
(allow file-read* (literal "/etc"))
(allow file-read* (literal "/tmp"))

; Temp directories (/tmp → /private/tmp on macOS)
(allow file-read*  (subpath "/private/tmp"))
(allow file-write* (subpath "/private/tmp"))
(allow file-read*  (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))

; Device access
(allow file-read*  (subpath "/dev"))
(allow file-write* (literal "/dev/null"))
(allow file-ioctl  (subpath "/dev"))

; Common user tool prefixes (Homebrew, nix, etc.)
(allow file-read* (subpath "/opt/homebrew"))
(allow file-read* (subpath "/usr/local"))
(allow file-read* (subpath "/nix"))

; Ancestor directories of HOME and PROJECT_ROOT (Node/npm realpath walks lstat these)
{ancestor_rules}
; HOME: read allowed; write only for common tool cache dirs.
; More-specific deny rules below take precedence over broader allows.
(allow file-read*  (subpath (param "HOME")))
(allow file-write* (subpath (string-append (param "HOME") "/.npm")))
(allow file-write* (subpath (string-append (param "HOME") "/.cache")))
(allow file-write* (subpath (string-append (param "HOME") "/.cargo")))
(allow file-write* (subpath (string-append (param "HOME") "/.local")))
(allow file-write* (subpath (string-append (param "HOME") "/Library/Caches")))

; Deny sensitive credential directories inside HOME
(deny file-read*  (subpath (string-append (param "HOME") "/.ssh")))
(deny file-write* (subpath (string-append (param "HOME") "/.ssh")))
(deny file-read*  (subpath (string-append (param "HOME") "/.aws")))
(deny file-write* (subpath (string-append (param "HOME") "/.aws")))
(deny file-read*  (subpath (string-append (param "HOME") "/.gnupg")))
(deny file-write* (subpath (string-append (param "HOME") "/.gnupg")))
{project_write_rules}
; TMPDIR (macOS uses /private/var/folders/…/T by default)
(allow file-read*  (subpath (param "TMPDIR")))
(allow file-write* (subpath (param "TMPDIR")))

{network_rule}"##
    )
}

/// Multi-root Seatbelt profile. A single root keeps the existing PROJECT_ROOT
/// parameter profile unchanged. Multiple roots bind every member RW (or RO)
/// using canonical literal paths, then re-protect `.git` and `.env` writes.
pub fn generate_seatbelt_profile_for_roots(
    allow_network: bool,
    project_writable: bool,
    home: &str,
    project_roots: &[&str],
) -> String {
    if project_roots.len() <= 1 {
        let root = project_roots.first().copied().unwrap_or("");
        return generate_seatbelt_profile_with(allow_network, project_writable, home, root);
    }

    use crate::commands::sandbox_protect::{
        canonicalize_sandbox_path, collect_env_protection_paths, resolve_git_protection_paths,
    };
    use std::path::Path;

    let canonical_roots: Vec<String> = project_roots
        .iter()
        .map(|root| canonicalize_sandbox_path(root))
        .collect();

    let ancestor_rules = format_ancestor_read_rules_many(home, &canonical_roots);
    let mut project_write_rules = String::new();
    for root in &canonical_roots {
        project_write_rules.push_str(&format!(
            "\n; Project root: {root}\n(allow file-read*  (subpath \"{root}\"))\n"
        ));
        if !project_writable {
            continue;
        }
        project_write_rules.push_str(&format!("(allow file-write* (subpath \"{root}\"))\n"));
        for git_path in resolve_git_protection_paths(Path::new(root)) {
            let git = git_path.to_string_lossy();
            project_write_rules.push_str(&format!("(deny file-write* (subpath \"{git}\"))\n"));
        }
        project_write_rules.push_str(&format!(
            r#"
(deny file-write*
  (require-all
    (subpath "{root}")
    (regex #"/\.env(\.[^/]*)?$")))
(allow file-write*
  (require-all
    (subpath "{root}")
    (regex #"/\.env\.(example|sample|template)$")))
"#
        ));
        for env_path in collect_env_protection_paths(Path::new(root)) {
            let env = env_path.to_string_lossy();
            project_write_rules.push_str(&format!("(deny file-write* (literal \"{env}\"))\n"));
        }
    }

    render_seatbelt_profile(allow_network, &ancestor_rules, &project_write_rules)
}

/// Ancestor directories of `path` from the parent up to (but not including) `/`.
/// Empty or relative paths yield no ancestors.
pub fn path_ancestors(path: &str) -> Vec<String> {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() || !trimmed.starts_with('/') {
        return Vec::new();
    }

    let mut ancestors = Vec::new();
    let mut current = trimmed.to_string();
    loop {
        let parent = match std::path::Path::new(&current).parent() {
            Some(p) => p.to_string_lossy().to_string(),
            None => break,
        };
        if parent.is_empty() || parent == "/" {
            break;
        }
        ancestors.push(parent.clone());
        current = parent;
    }
    ancestors
}

fn format_ancestor_read_rules(home: &str, project_root: &str) -> String {
    format_ancestor_read_rules_many(home, &[project_root.to_string()])
}

fn format_ancestor_read_rules_many(home: &str, project_roots: &[String]) -> String {
    let mut seen = std::collections::BTreeSet::new();
    for ancestor in path_ancestors(home) {
        seen.insert(ancestor);
    }
    for path in project_roots {
        for ancestor in path_ancestors(path) {
            seen.insert(ancestor);
        }
    }

    if seen.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    for ancestor in seen {
        out.push_str(&format!("(allow file-read* (literal \"{ancestor}\"))\n"));
    }
    out
}
