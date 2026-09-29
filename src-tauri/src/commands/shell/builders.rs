use std::process::Stdio;

use tokio::process::Command;

use crate::commands::mcp::merged_shell_path;

#[cfg(target_os = "macos")]
use super::super::sandbox::generate_seatbelt_profile_with;

fn apply_merged_shell_path(cmd: &mut Command) {
    if let Some(merged) = merged_shell_path() {
        cmd.env("PATH", merged);
    }
}

/// Resolve bash for `pipefail` honest pipeline exit codes.
/// Cached once. Returns `None` when bash is unavailable (caller falls back to `sh`).
#[cfg(unix)]
fn resolve_bash() -> Option<&'static str> {
    static BASH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    BASH.get_or_init(|| {
        if std::path::Path::new("/bin/bash").exists() {
            return Some("/bin/bash".to_string());
        }
        std::process::Command::new("which")
            .arg("bash")
            .output()
            .ok()
            .and_then(|out| {
                if !out.status.success() {
                    return None;
                }
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if path.is_empty() {
                    None
                } else {
                    Some(path)
                }
            })
    })
    .as_deref()
}

/// Append shell invocation args: `bash -o pipefail -c <command>`, or `sh -c <command>`.
/// Used when the shell binary is an argument (sandbox-exec / bwrap), not Command::new.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn append_shell_command(cmd: &mut Command, command: &str) {
    match resolve_bash() {
        Some(bash) => {
            cmd.arg(bash)
                .arg("-o")
                .arg("pipefail")
                .arg("-c")
                .arg(command);
        }
        None => {
            cmd.arg("sh").arg("-c").arg(command);
        }
    }
}

#[cfg(unix)]
fn build_tracked_command(project_root: &str, command: &str) -> Command {
    let mut cmd = match resolve_bash() {
        Some(bash) => {
            let mut cmd = Command::new(bash);
            cmd.arg("-o").arg("pipefail");
            cmd
        }
        None => Command::new("sh"),
    };
    cmd.arg("-c")
        .arg(command)
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_merged_shell_path(&mut cmd);

    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    cmd
}

#[cfg(windows)]
fn build_tracked_command(project_root: &str, command: &str) -> Command {
    let mut cmd = Command::new("cmd.exe");
    cmd.arg("/c")
        .arg(command)
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_merged_shell_path(&mut cmd);
    cmd
}

/// On macOS: wrap the command with `sandbox-exec` using a generated Seatbelt profile.
/// The sandboxed child still gets its own process group (via setpgid) so that
/// `killpg` continues to work for the full process tree.
#[cfg(target_os = "macos")]
fn build_sandboxed_command(
    project_root: &str,
    command: &str,
    allow_network: bool,
    project_writable: bool,
) -> Command {
    use std::env;

    let home = env::var("HOME").unwrap_or_default();
    let tmpdir_raw = env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
    let tmpdir = std::fs::canonicalize(&tmpdir_raw)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(tmpdir_raw);
    let project_root_clean = project_root.trim_end_matches('/').to_string();
    let profile =
        generate_seatbelt_profile_with(allow_network, project_writable, &home, &project_root_clean);

    let mut cmd = Command::new("/usr/bin/sandbox-exec");
    cmd.arg("-D")
        .arg(format!("HOME={home}"))
        .arg("-D")
        .arg(format!("PROJECT_ROOT={project_root_clean}"))
        .arg("-D")
        .arg(format!("TMPDIR={tmpdir}"))
        .arg("-p")
        .arg(profile);
    append_shell_command(&mut cmd, command);
    cmd.current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_merged_shell_path(&mut cmd);
    cmd.env("TMPDIR", &tmpdir);

    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    cmd
}

/// On Linux: wrap the command with `bwrap` (bubblewrap) for namespace-based sandboxing.
/// Bind-mounts project_root RW (or RO when `project_writable` is false), common
/// system paths RO, and a fresh tmpfs for /tmp.
/// Network isolation is applied when `allow_network` is false.
#[cfg(target_os = "linux")]
fn find_bwrap() -> Option<String> {
    let candidates = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"];
    for candidate in &candidates {
        if std::path::Path::new(candidate).exists() {
            return Some((*candidate).to_string());
        }
    }
    // Fall back to PATH search
    std::process::Command::new("which")
        .arg("bwrap")
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
            None
        })
}

#[cfg(target_os = "linux")]
fn build_bubblewrap_command(
    bwrap: &str,
    project_root: &str,
    command: &str,
    allow_network: bool,
    project_writable: bool,
) -> Command {
    let mut cmd = Command::new(bwrap);

    // Read-only system mounts
    for ro_path in &["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc"] {
        if std::path::Path::new(ro_path).exists() {
            cmd.arg("--ro-bind").arg(ro_path).arg(ro_path);
        }
    }

    // Common tool prefixes (nix, snap)
    for opt_path in &["/opt", "/run/current-system", "/nix"] {
        if std::path::Path::new(opt_path).exists() {
            cmd.arg("--ro-bind").arg(opt_path).arg(opt_path);
        }
    }

    // /dev and /proc (required for most shell commands)
    cmd.arg("--dev").arg("/dev");
    cmd.arg("--proc").arg("/proc");

    // tmpfs for /tmp
    cmd.arg("--tmpfs").arg("/tmp");

    // Project root: RW unless the caller requested a read-only project jail
    if project_writable {
        cmd.arg("--bind").arg(project_root).arg(project_root);
    } else {
        cmd.arg("--ro-bind").arg(project_root).arg(project_root);
    }

    // HOME: read-write so tool caches work, but only if it differs from project root
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() && home != project_root {
            cmd.arg("--bind").arg(&home).arg(&home);
        }
    }

    // Network isolation
    if !allow_network {
        cmd.arg("--unshare-net");
    }

    // Kill bwrap sandbox when the parent process exits
    cmd.arg("--die-with-parent");

    // The actual command
    cmd.arg("--");
    append_shell_command(&mut cmd, command);
    cmd.current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_merged_shell_path(&mut cmd);
    cmd.env("TMPDIR", "/tmp");

    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    cmd
}

/// Spawn the child process, applying OS-appropriate sandboxing when requested.
///
/// - macOS: `sandbox-exec` with a generated Seatbelt profile.
/// - Linux: `bwrap` (bubblewrap) with namespace isolation when available.
///   If bwrap is not installed and the caller requested sandboxing, returns
///   `Err("SANDBOX_UNAVAILABLE: install bubblewrap")`.
/// - Other platforms: refuse sandboxed spawns (`SANDBOX_UNAVAILABLE`); unsandboxed
///   only when the caller explicitly sets `sandboxed: false`.
///
/// Default when `sandboxed` is `None` is sandboxed (`true`). This is OS process
/// isolation for the agent shell tool only, not a full VM or MCP/LSP sandbox.
pub(crate) fn spawn_child(
    project_root: &str,
    command: &str,
    sandboxed: Option<bool>,
    allow_network: Option<bool>,
    project_writable: Option<bool>,
) -> Result<tokio::process::Child, String> {
    let want_sandbox = sandboxed.unwrap_or(true);
    let allow_network = allow_network.unwrap_or(false);
    let project_writable = project_writable.unwrap_or(true);

    #[cfg(target_os = "macos")]
    {
        if want_sandbox {
            return build_sandboxed_command(project_root, command, allow_network, project_writable)
                .spawn()
                .map_err(|e| format!("SANDBOX_FAILED: {e}"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if want_sandbox {
            match find_bwrap() {
                Some(bwrap) => {
                    return build_bubblewrap_command(
                        &bwrap,
                        project_root,
                        command,
                        allow_network,
                        project_writable,
                    )
                    .spawn()
                    .map_err(|e| format!("SANDBOX_FAILED: {e}"));
                }
                None => {
                    return Err("SANDBOX_UNAVAILABLE: install bubblewrap".to_string());
                }
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        if want_sandbox {
            return Err(
        "SANDBOX_UNAVAILABLE: no OS sandbox on this platform; approve unsandboxed shell to continue"
          .to_string(),
      );
        }
    }

    let _ = (allow_network, project_writable);

    build_tracked_command(project_root, command)
        .spawn()
        .map_err(|e| e.to_string())
}
