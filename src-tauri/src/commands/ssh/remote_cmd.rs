use super::channels::{exec_wait, SshExecResult};
use super::session::{session_key, SessionKey};
use crate::commands::fs::{parse_ssh_project_root, SshProjectRoot};

pub fn is_ssh_root(value: &str) -> bool {
    value.trim().starts_with("ssh://")
}

pub fn posix_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn join_remote_argv(parts: &[impl AsRef<str>]) -> String {
    parts
        .iter()
        .map(|part| posix_quote(part.as_ref()))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn unreachable_host(hostname: &str) -> String {
    format!("{hostname} is unreachable.")
}

pub fn missing_program(program: &str, hostname: &str) -> String {
    format!("{program} is not installed on {hostname}.")
}

pub fn indexer_cannot_run(hostname: &str) -> String {
    format!("The graph indexer cannot run on {hostname}.")
}

pub fn git_hooks_refused(hostname: &str) -> String {
    format!("Writing .git/hooks on {hostname} is refused.")
}

pub fn inotify_enospc(hostname: &str) -> String {
    format!("inotify ENOSPC on {hostname}.")
}

pub fn inotifywait_missing(hostname: &str) -> String {
    format!("inotifywait is not installed on {hostname}.")
}

pub fn map_unreachable(hostname: &str, err: String) -> String {
    let lower = err.to_ascii_lowercase();
    if lower.contains("unreachable")
        || lower.contains("not connected")
        || lower.contains("master is dead")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("connection lost")
    {
        unreachable_host(hostname)
    } else {
        err
    }
}

pub fn looks_like_missing_program(
    program: &str,
    stdout: &str,
    stderr: &str,
    exit_code: i32,
) -> bool {
    if exit_code == 127 {
        return true;
    }
    let hay = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    let prog = program.to_ascii_lowercase();
    let not_found = hay.contains("command not found")
        || hay.contains("not found")
        || hay.contains("no such file or directory");
    not_found && (hay.contains(&prog) || exit_code == 127)
}

pub fn looks_like_enospc(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("enospc")
        || (lower.contains("no space left") && lower.contains("inotify"))
        || lower.contains("user limit of inotify")
        || (lower.contains("inotify instance") && lower.contains("reached"))
}

pub fn relative_is_git_hooks(relative: &str) -> bool {
    let trimmed = relative.trim().replace('\\', "/");
    let trimmed = trimmed.trim_start_matches('/');
    trimmed == ".git/hooks" || trimmed.starts_with(".git/hooks/")
}

pub fn reject_git_hooks_write(relative: &str, hostname: &str) -> Result<(), String> {
    if relative_is_git_hooks(relative) {
        Err(git_hooks_refused(hostname))
    } else {
        Ok(())
    }
}

pub fn parse_root(project_root: &str) -> Result<SshProjectRoot, String> {
    parse_ssh_project_root(project_root)
}

pub fn key_for(root: &SshProjectRoot) -> SessionKey {
    session_key(&root.user, &root.hostname, root.port)
}

pub fn ssh_uri_for(root: &SshProjectRoot, remote_path: &str) -> String {
    let path = if remote_path.starts_with('/') {
        remote_path.to_string()
    } else {
        format!("/{remote_path}")
    };
    if root.port == 22 {
        format!("ssh://{}@{}{}", root.user, root.hostname, path)
    } else {
        format!(
            "ssh://{}@{}:{}{}",
            root.user, root.hostname, root.port, path
        )
    }
}

pub fn login_command(remote_cwd: &str, command: &str) -> String {
    format!("cd {} && {}", posix_quote(remote_cwd), command)
}

pub fn tty_login_command(remote_cwd: &str) -> String {
    format!(
        "cd {} && exec ${{SHELL:-/bin/sh}} -l",
        posix_quote(remote_cwd)
    )
}

pub fn block_on<T>(fut: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(fut)),
        Err(_) => tauri::async_runtime::block_on(fut),
    }
}

pub async fn exec_on(root: &SshProjectRoot, command: String) -> Result<SshExecResult, String> {
    exec_wait(key_for(root), command)
        .await
        .map_err(|err| map_unreachable(&root.hostname, err))
}

pub async fn probe_remote_program(root: &SshProjectRoot, program: &str) -> Result<(), String> {
    let command = format!("command -v {}", posix_quote(program));
    let result = exec_on(root, command).await?;
    if result.exit_code != 0
        || looks_like_missing_program(program, &result.stdout, &result.stderr, result.exit_code)
    {
        return Err(missing_program(program, &root.hostname));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_rg_sentence_is_exact() {
        assert_eq!(
            missing_program("rg", "eva.local"),
            "rg is not installed on eva.local."
        );
    }

    #[test]
    fn hooks_relative_matches() {
        assert!(relative_is_git_hooks(".git/hooks/pre-commit"));
        assert!(relative_is_git_hooks(".git/hooks"));
        assert!(!relative_is_git_hooks(".git/config"));
        assert!(!relative_is_git_hooks("src/hooks/pre-commit"));
    }

    #[test]
    fn posix_quote_escapes_single_quotes() {
        assert_eq!(posix_quote("a'b"), "'a'\\''b'");
        assert_eq!(posix_quote(""), "''");
    }
}
