use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AliasParse {
    pub aliases: Vec<String>,
    pub saw_match: bool,
    pub include_errors: Vec<String>,
}

pub fn parse_host_aliases(config_path: &Path) -> AliasParse {
    let mut parsed = AliasParse::default();
    let mut visited = Vec::new();
    parse_file(config_path, 0, &mut visited, &mut parsed);
    parsed.aliases.sort();
    parsed.aliases.dedup();
    parsed
}

fn parse_file(path: &Path, depth: u8, visited: &mut Vec<PathBuf>, parsed: &mut AliasParse) {
    if depth > 16 {
        parsed
            .include_errors
            .push(format!("Include depth exceeded at {}", path.display()));
        return;
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if visited.iter().any(|seen| seen == &canonical) {
        return;
    }
    visited.push(canonical.clone());
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => {
            parsed.include_errors.push(format!(
                "Vixl could not read the included file {}",
                path.display()
            ));
            return;
        }
    };
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    for raw_line in text.lines() {
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(keyword) = parts.next() else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("Match") {
            parsed.saw_match = true;
            continue;
        }
        if keyword.eq_ignore_ascii_case("Host") {
            for token in parts {
                if is_concrete_alias(token) {
                    parsed.aliases.push(token.to_string());
                }
            }
            continue;
        }
        if keyword.eq_ignore_ascii_case("Include") {
            for token in parts {
                let include_path = expand_include_path(token, parent);
                for resolved in expand_include_glob(&include_path) {
                    parse_file(&resolved, depth + 1, visited, parsed);
                }
            }
        }
    }
}

fn strip_comment(line: &str) -> &str {
    match line.find('#') {
        Some(index) => &line[..index],
        None => line,
    }
}

fn is_concrete_alias(token: &str) -> bool {
    !token.is_empty() && !token.contains('*') && !token.contains('?') && !token.starts_with('!')
}

fn expand_include_path(token: &str, parent: &Path) -> PathBuf {
    if let Some(rest) = token.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    let path = PathBuf::from(token);
    if path.is_absolute() {
        path
    } else {
        parent.join(path)
    }
}

fn expand_include_glob(path: &Path) -> Vec<PathBuf> {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return vec![path.to_path_buf()];
    };
    if !name.contains('*') && !name.contains('?') {
        return vec![path.to_path_buf()];
    }
    let Some(dir) = path.parent() else {
        return vec![path.to_path_buf()];
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![path.to_path_buf()];
    };
    let mut matches = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(file_str) = file_name.to_str() else {
            continue;
        };
        if glob_match(name, file_str) {
            matches.push(entry.path());
        }
    }
    if matches.is_empty() {
        vec![path.to_path_buf()]
    } else {
        matches.sort();
        matches
    }
}

fn glob_match(pattern: &str, name: &str) -> bool {
    glob_match_inner(pattern.as_bytes(), name.as_bytes())
}

fn glob_match_inner(pattern: &[u8], name: &[u8]) -> bool {
    match (pattern.first(), name.first()) {
        (None, None) => true,
        (Some(b'*'), _) => {
            glob_match_inner(&pattern[1..], name)
                || (!name.is_empty() && glob_match_inner(pattern, &name[1..]))
        }
        (Some(b'?'), Some(_)) => glob_match_inner(&pattern[1..], &name[1..]),
        (Some(p), Some(n)) if p == n => glob_match_inner(&pattern[1..], &name[1..]),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_concrete_hosts_and_includes_without_match_exec() {
        let dir = tempdir().expect("tempdir");
        let included = dir.path().join("extra.conf");
        fs::write(&included, "Host included-alias\n  HostName 127.0.0.1\n").expect("write include");
        let config = dir.path().join("config");
        fs::write(
            &config,
            format!(
                "Host eva lab\n  HostName eva.local\nHost *\n  Compression yes\nHost ?\nInclude {}\nMatch host eva exec true\n  IdentityFile /tmp/id\n",
                included.display()
            ),
        )
        .expect("write config");
        let parsed = parse_host_aliases(&config);
        assert!(parsed.aliases.contains(&"eva".to_string()));
        assert!(parsed.aliases.contains(&"lab".to_string()));
        assert!(parsed.aliases.contains(&"included-alias".to_string()));
        assert!(!parsed.aliases.iter().any(|alias| alias.contains('*')));
        assert!(parsed.saw_match);
        assert!(parsed.include_errors.is_empty());
    }

    #[test]
    fn unreadable_include_does_not_hide_aliases() {
        let dir = tempdir().expect("tempdir");
        let config = dir.path().join("config");
        fs::write(
            &config,
            "Host eva\nInclude /no/such/vixl-ssh-include.conf\n",
        )
        .expect("write");
        let parsed = parse_host_aliases(&config);
        assert!(parsed.aliases.contains(&"eva".to_string()));
        assert!(!parsed.include_errors.is_empty());
    }
}
