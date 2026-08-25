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
pub fn generate_seatbelt_profile(allow_network: bool, home: &str, project_root: &str) -> String {
    let network_rule = if allow_network {
        "(allow network*)\n"
    } else {
        ""
    };

    let ancestor_rules = format_ancestor_read_rules(home, project_root);

    format!(
        r#"(version 1)
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

; Project root: full read/write access
(allow file-read*  (subpath (param "PROJECT_ROOT")))
(allow file-write* (subpath (param "PROJECT_ROOT")))

; Deny writes to .git/hooks to prevent hook injection attacks
(deny file-write* (subpath (string-append (param "PROJECT_ROOT") "/.git/hooks")))

; TMPDIR (macOS uses /private/var/folders/…/T by default)
(allow file-read*  (subpath (param "TMPDIR")))
(allow file-write* (subpath (param "TMPDIR")))

{network_rule}"#
    )
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
    let mut seen = std::collections::BTreeSet::new();
    for path in [home, project_root] {
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
