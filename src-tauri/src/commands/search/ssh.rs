use crate::commands::fs::SshProjectRoot;
use crate::commands::ssh::{
    exec_on, join_remote_argv, login_command, looks_like_missing_program, missing_program,
    posix_quote, probe_remote_program,
};

use super::glob::{GlobFileEntry, WorkspaceGlobResult};
use super::grep::{GrepMatch, WorkspaceGrepRequest, WorkspaceGrepResult};

pub(crate) async fn grep_ssh(
    ssh: &SshProjectRoot,
    request: &WorkspaceGrepRequest,
    search_rel: &str,
    prefix: Option<&str>,
    max_results: usize,
) -> Result<WorkspaceGrepResult, String> {
    probe_remote_program(ssh, "rg")
        .await
        .map_err(|_| missing_program("rg", &ssh.hostname))?;
    let mut args = vec!["rg".to_string(), "-n".to_string(), "--column".to_string()];
    args.push("--color".to_string());
    args.push("never".to_string());
    args.push("--no-heading".to_string());
    if request.case_insensitive.unwrap_or(false) {
        args.push("-i".to_string());
    }
    if !request.regex.unwrap_or(true) {
        args.push("-F".to_string());
    }
    if request.whole_word.unwrap_or(false) {
        args.push("-w".to_string());
    }
    if let Some(glob) = request
        .glob
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("-g".to_string());
        args.push(glob.to_string());
    }
    if let Some(exclude) = request
        .exclude_glob
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("-g".to_string());
        args.push(format!("!{exclude}"));
    }
    args.push("--".to_string());
    args.push(request.pattern.clone());
    if !search_rel.is_empty() && search_rel != "." {
        args.push(search_rel.to_string());
    }
    let quoted: Vec<String> = args.iter().map(|part| posix_quote(part)).collect();
    let command = login_command(&ssh.remote_path, &quoted.join(" "));
    let result = exec_on(ssh, command).await?;
    if looks_like_missing_program("rg", &result.stdout, &result.stderr, result.exit_code) {
        return Err(missing_program("rg", &ssh.hostname));
    }
    if result.exit_code != 0
        && result.exit_code != 1
        && !result.stderr.trim().is_empty()
        && result.stdout.trim().is_empty()
    {
        return Err(result.stderr.trim().to_string());
    }
    let mut matches = Vec::new();
    let mut truncated = false;
    for line in result.stdout.lines() {
        if matches.len() >= max_results {
            truncated = true;
            break;
        }
        let Some(parsed) = parse_rg_line(line) else {
            continue;
        };
        let path = match prefix {
            Some(prefix) if parsed.path.is_empty() => prefix.to_string(),
            Some(prefix) => format!("{prefix}/{}", parsed.path),
            None => parsed.path,
        };
        matches.push(GrepMatch {
            path,
            line_number: parsed.line_number,
            line: parsed.line,
            start_column: parsed.start_column,
            end_column: parsed.end_column,
        });
    }
    Ok(WorkspaceGrepResult { matches, truncated })
}

struct ParsedRg {
    path: String,
    line_number: u32,
    line: String,
    start_column: Option<u32>,
    end_column: Option<u32>,
}

fn parse_rg_line(line: &str) -> Option<ParsedRg> {
    let (path, rest) = line.split_once(':')?;
    let (line_number, rest) = rest.split_once(':')?;
    let line_number = line_number.parse().ok()?;
    let (column, text) = match rest.split_once(':') {
        Some((column, text)) if column.chars().all(|ch| ch.is_ascii_digit()) => {
            (column.parse::<u32>().ok(), text)
        }
        _ => (None, rest),
    };
    Some(ParsedRg {
        path: path.to_string(),
        line_number,
        line: text.to_string(),
        start_column: column,
        end_column: None,
    })
}

pub(crate) async fn glob_ssh(
    ssh: &SshProjectRoot,
    pattern: &str,
    prefix: Option<&str>,
    limit: usize,
) -> Result<WorkspaceGlobResult, String> {
    probe_remote_program(ssh, "rg")
        .await
        .map_err(|_| missing_program("rg", &ssh.hostname))?;
    let command = login_command(
        &ssh.remote_path,
        &join_remote_argv(&["rg", "--files", "--glob", pattern]),
    );
    let result = exec_on(ssh, command).await?;
    if looks_like_missing_program("rg", &result.stdout, &result.stderr, result.exit_code) {
        return Err(missing_program("rg", &ssh.hostname));
    }
    if result.exit_code != 0
        && result.exit_code != 1
        && result.stdout.trim().is_empty()
        && !result.stderr.trim().is_empty()
    {
        return Err(result.stderr.trim().to_string());
    }
    let mut files = Vec::new();
    let mut truncated = false;
    for line in result.stdout.lines() {
        if files.len() >= limit {
            truncated = true;
            break;
        }
        let rel = line.trim();
        if rel.is_empty() {
            continue;
        }
        let path = match prefix {
            Some(prefix) => format!("{prefix}/{rel}"),
            None => rel.to_string(),
        };
        files.push(GlobFileEntry { path });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(WorkspaceGlobResult { files, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rg_line_with_column() {
        let parsed = parse_rg_line("src/main.rs:12:4:hello").expect("line");
        assert_eq!(parsed.path, "src/main.rs");
        assert_eq!(parsed.line_number, 12);
        assert_eq!(parsed.start_column, Some(4));
        assert_eq!(parsed.line, "hello");
    }
}
