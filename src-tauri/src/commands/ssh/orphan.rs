use std::fs::File;
use std::path::Path;
use std::process::Command;

#[cfg(unix)]
use std::os::unix::io::AsRawFd;

pub struct ControlLock {
    _file: File,
}

#[cfg(unix)]
pub fn acquire_control_lock(path: &Path) -> Result<ControlLock, String> {
    if let Some(parent) = path.parent() {
        super::paths::ensure_dir_mode_0700(parent)?;
    }
    let file = File::options()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|err| format!("Could not open SSH lock {}: {err}", path.display()))?;
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc != 0 {
        return Err(super::errors::control_lock_busy(
            &path.display().to_string(),
        ));
    }
    Ok(ControlLock { _file: file })
}

#[cfg(not(unix))]
pub fn acquire_control_lock(path: &Path) -> Result<ControlLock, String> {
    let file = File::options()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|err| format!("Could not open SSH lock {}: {err}", path.display()))?;
    Ok(ControlLock { _file: file })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshProcess {
    pub pid: i32,
    pub argv: String,
}

pub fn list_ssh_processes() -> Vec<SshProcess> {
    let output = Command::new("/bin/ps")
        .args(["-axwww", "-o", "pid=,command="])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_ps_ssh(&stdout)
}

pub fn parse_ps_ssh(stdout: &str) -> Vec<SshProcess> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((pid_str, command)) = split_pid_command(trimmed) else {
            continue;
        };
        let Ok(pid) = pid_str.parse::<i32>() else {
            continue;
        };
        if process_is_ssh(command) {
            out.push(SshProcess {
                pid,
                argv: command.to_string(),
            });
        }
    }
    out
}

fn split_pid_command(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.splitn(2, char::is_whitespace);
    let pid = parts.next()?;
    let command = parts.next()?.trim();
    Some((pid, command))
}

pub fn process_is_ssh(command: &str) -> bool {
    let first = command.split_whitespace().next().unwrap_or("");
    first == "/usr/bin/ssh" || first == "ssh" || first.ends_with("/ssh")
}

pub fn argv_has_control_path(command: &str, control_path: &str) -> bool {
    command
        .split_whitespace()
        .any(|part| part.contains(control_path))
        || command.contains(control_path)
}

pub fn reap_orphans_for_control_path(control_path: &str) -> Vec<i32> {
    let mut killed = Vec::new();
    for process in list_ssh_processes() {
        if !argv_has_control_path(&process.argv, control_path) {
            continue;
        }
        if !process_is_ssh(&process.argv) {
            continue;
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(process.pid, libc::SIGTERM);
        }
        killed.push(process.pid);
    }
    killed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_signals_ssh_without_control_path() {
        let listed = parse_ps_ssh(
            "  12 /usr/bin/ssh eva\n  13 /usr/bin/ssh -o ControlPath=/vixl/ssh/cm/abcd eva\n  14 grep ControlPath=/vixl/ssh/cm/abcd\n",
        );
        let control = "/vixl/ssh/cm/abcd";
        let targets: Vec<_> = listed
            .into_iter()
            .filter(|proc| process_is_ssh(&proc.argv) && argv_has_control_path(&proc.argv, control))
            .map(|proc| proc.pid)
            .collect();
        assert_eq!(targets, vec![13]);
    }
}
