use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::commands::codegraph::graph_id_for_identity;
use crate::commands::fs::fs_write_file;
use crate::commands::git::git_status;
use crate::commands::search::{workspace_grep, WorkspaceGrepRequest};
use super::channels::{open_exec, wait_channel_exit};
use super::remote_cmd::{git_hooks_refused, indexer_cannot_run, login_command, missing_program, probe_remote_program};
use super::session::{
    clear_sessions_for_tests, connect, disconnect, insert_test_session, session_key,
    SshConnectRequest, SshSessionStatus, SESSION_TEST_LOCK,
};
use super::SshPaths;

const SSHD_BIN: &str = "/usr/sbin/sshd";
const KEYGEN_BIN: &str = "/usr/bin/ssh-keygen";

struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct ShortDir(PathBuf);

impl Drop for ShortDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn whoami() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| "nobody".to_string())
}

fn ssh_root(user: &str, port: u16, remote: &Path) -> String {
    format!("ssh://{user}@127.0.0.1:{port}{}", remote.to_string_lossy())
}

fn try_start_sshd(dir: &Path, port: u16, user: &str) -> Result<(ChildGuard, PathBuf), String> {
    let host_key = dir.join("host_ed25519");
    let user_key = dir.join("user_ed25519");
    let authorized = dir.join("authorized_keys");
    let config = dir.join("sshd_config");
    let pid_file = dir.join("sshd.pid");

    let host_status = Command::new(KEYGEN_BIN)
        .args([
            "-t",
            "ed25519",
            "-f",
            &host_key.to_string_lossy(),
            "-N",
            "",
            "-q",
        ])
        .status()
        .map_err(|err| format!("ssh-keygen host key: {err}"))?;
    if !host_status.success() {
        return Err("ssh-keygen failed to write the temp host key".to_string());
    }
    let user_status = Command::new(KEYGEN_BIN)
        .args([
            "-t",
            "ed25519",
            "-f",
            &user_key.to_string_lossy(),
            "-N",
            "",
            "-q",
        ])
        .status()
        .map_err(|err| format!("ssh-keygen user key: {err}"))?;
    if !user_status.success() {
        return Err("ssh-keygen failed to write the temp user key".to_string());
    }
    let pub_key = fs::read_to_string(user_key.with_extension("pub"))
        .map_err(|err| format!("read user pub: {err}"))?;
    fs::write(&authorized, pub_key).map_err(|err| format!("write authorized_keys: {err}"))?;

    let config_text = format!(
        "Port {port}\n\
         ListenAddress 127.0.0.1\n\
         HostKey {host_key}\n\
         PidFile {pid_file}\n\
         AuthorizedKeysFile {authorized}\n\
         PubkeyAuthentication yes\n\
         PasswordAuthentication no\n\
         KbdInteractiveAuthentication no\n\
         ChallengeResponseAuthentication no\n\
         UsePAM no\n\
         StrictModes no\n\
         PermitRootLogin no\n\
         AuthenticationMethods publickey\n\
         AllowUsers {user}\n\
         Subsystem sftp internal-sftp\n",
        host_key = host_key.display(),
        pid_file = pid_file.display(),
        authorized = authorized.display(),
    );
    fs::write(&config, config_text).map_err(|err| format!("write sshd_config: {err}"))?;

    let mut child = Command::new(SSHD_BIN)
        .args([
            "-f",
            &config.to_string_lossy(),
            "-D",
            "-e",
            "-p",
            &port.to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to spawn {SSHD_BIN}: {err}"))?;

    std::thread::sleep(Duration::from_millis(300));
    match child.try_wait() {
        Ok(Some(status)) => {
            let mut stderr = String::new();
            if let Some(mut reader) = child.stderr.take() {
                use std::io::Read;
                let _ = reader.read_to_string(&mut stderr);
            }
            Err(format!("{SSHD_BIN} exited {status}. stderr: {stderr}"))
        }
        Ok(None) => Ok((ChildGuard(child), user_key)),
        Err(err) => Err(format!("failed to poll {SSHD_BIN}: {err}")),
    }
}

fn seed_known_hosts(paths: &SshPaths, port: u16, host_pub: &Path) -> Result<(), String> {
    let pub_text = fs::read_to_string(host_pub).map_err(|err| err.to_string())?;
    let line = pub_text.trim().to_string();
    let formatted = format!("[127.0.0.1]:{port} {line}\n");
    fs::create_dir_all(&paths.vixl_ssh_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&paths.user_ssh_dir).map_err(|err| err.to_string())?;
    fs::write(paths.known_hosts(), formatted).map_err(|err| err.to_string())
}

fn git_init(dir: &Path) {
    let status = Command::new("git")
        .args(["init"])
        .current_dir(dir)
        .status()
        .expect("git init");
    assert!(status.success(), "git init failed");
    let _ = Command::new("git")
        .args(["config", "user.email", "vixl-test@example.com"])
        .current_dir(dir)
        .status();
    let _ = Command::new("git")
        .args(["config", "user.name", "vixl-test"])
        .current_dir(dir)
        .status();
}

#[test]
fn missing_rg_sentence_is_exact() {
    assert_eq!(
        missing_program("rg", "eva.local"),
        "rg is not installed on eva.local."
    );
}

#[test]
fn indexer_cannot_run_sentence_is_exact() {
    assert_eq!(
        indexer_cannot_run("host.example"),
        "The graph indexer cannot run on host.example."
    );
}

#[test]
fn ssh_graph_id_is_stable_and_differs_from_local_suffix() {
    let uri = "ssh://user@host.example/tmp/proj";
    assert_eq!(graph_id_for_identity(uri), graph_id_for_identity(uri));
    assert_ne!(
        graph_id_for_identity(uri),
        graph_id_for_identity("/tmp/proj")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn dead_master_names_the_host() {
    let _lock = SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
    insert_test_session(
        SshSessionStatus {
            user: "tester".to_string(),
            hostname: "testhost.example".to_string(),
            port: 22,
            destination: "testhost".to_string(),
            state: "disconnected".to_string(),
            line: "testhost.example is not connected".to_string(),
            last_error: None,
            master_alive: false,
        },
        paths,
        dir.path().join("cm-missing"),
    )
    .await;
    let err = git_status(
        "ssh://tester@testhost.example/tmp/proj".into(),
        None,
    )
    .await
    .expect_err("dead");
    assert!(
        err.contains("testhost.example is unreachable."),
        "got {err}"
    );
    clear_sessions_for_tests().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn disposable_sshd_remote_exec_locks() {
    let _lock = SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    if !Path::new(SSHD_BIN).exists() {
        eprintln!("{SSHD_BIN} is not present. Kept unit tests. No disposable sshd.");
        return;
    }
    let user = whoami();
    let short_root = PathBuf::from(format!("/tmp/vxe{}", std::process::id()));
    let _ = fs::remove_dir_all(&short_root);
    fs::create_dir_all(&short_root).expect("short temp dir");
    let dir_guard = ShortDir(short_root.clone());
    let port = 23222u16;
    match try_start_sshd(&short_root, port, &user) {
        Err(stderr) => {
            eprintln!("{SSHD_BIN} could not run as this user. stderr: {stderr}");
        }
        Ok((guard, user_key)) => {
            let paths = SshPaths::from_roots(short_root.join("v"), short_root.join("u"));
            seed_known_hosts(&paths, port, &short_root.join("host_ed25519.pub"))
                .expect("known_hosts");
            let request = SshConnectRequest {
                destination: format!("{user}@127.0.0.1"),
                user: Some(user.clone()),
                port: Some(port),
                identity_file: Some(user_key.to_string_lossy().into_owned()),
                password_only: Some(false),
                config_file: None,
                vixl_ssh_dir: Some(paths.vixl_ssh_dir.to_string_lossy().into_owned()),
                user_ssh_dir: Some(paths.user_ssh_dir.to_string_lossy().into_owned()),
            };
            match connect(None, request).await {
                Ok(status) => {
                    assert!(status.master_alive, "master should be alive");
                    run_live_exec_cases(&user, port, &short_root).await;
                    let _ = disconnect(&user, "127.0.0.1", port).await;
                }
                Err(err) => {
                    eprintln!("connect to disposable sshd failed: {err}");
                }
            }
            drop(guard);
        }
    }
    drop(dir_guard);
    clear_sessions_for_tests().await;
}

async fn run_live_exec_cases(user: &str, port: u16, short_root: &Path) {
    let remote = short_root.join("proj");
    fs::create_dir_all(&remote).expect("remote proj");
    let decoy = tempfile::tempdir().expect("decoy");
    git_init(decoy.path());
    fs::write(decoy.path().join("decoy-only.txt"), "LOCAL_NEEDLE\n").expect("decoy file");
    let _ = Command::new("git")
        .args(["add", "decoy-only.txt"])
        .current_dir(decoy.path())
        .status();
    let _ = Command::new("git")
        .args(["commit", "-m", "decoy"])
        .current_dir(decoy.path())
        .status();

    git_init(&remote);
    fs::write(remote.join("remote-only.txt"), "REMOTE_NEEDLE\n").expect("remote file");
    let _ = Command::new("git")
        .args(["add", "remote-only.txt"])
        .current_dir(&remote)
        .status();
    let _ = Command::new("git")
        .args(["commit", "-m", "remote"])
        .current_dir(&remote)
        .status();
    fs::write(remote.join("unstaged-remote.txt"), "unstaged\n").expect("unstaged");

    let root = ssh_root(user, port, &remote);
    let hostname = "127.0.0.1";
    assert_eq!(
        missing_program("rg", hostname),
        format!("rg is not installed on {hostname}.")
    );

    let status = git_status(root.clone(), None)
        .await
        .expect("remote git status");
    let paths: Vec<_> = status.entries.iter().map(|entry| entry.path.as_str()).collect();
    assert!(
        paths.iter().any(|path| path.contains("unstaged-remote.txt")),
        "remote git status was {paths:?}"
    );
    assert!(
        paths.iter().all(|path| !path.contains("decoy-only.txt")),
        "remote git status used the decoy: {paths:?}"
    );

    let hooks = fs_write_file(
        root.clone(),
        ".git/hooks/pre-commit".into(),
        "#!/bin/sh\n".into(),
        Some(true),
        None,
    )
    .expect_err("hooks");
    assert_eq!(hooks, git_hooks_refused(hostname));

    let decoy_marker = decoy.path().join("agent-exec-marker");
    let local_cwd_marker = PathBuf::from("vixl-agent-exec-marker");
    let _ = fs::remove_file(&decoy_marker);
    let _ = fs::remove_file(&local_cwd_marker);
    let command = "printf 'remote-exec\\n' > agent-exec-marker";
    let info = open_exec(
        session_key(user, "127.0.0.1", port),
        login_command(&remote.to_string_lossy(), command),
    )
    .await
    .expect("agent exec");
    let _ = wait_channel_exit(&info.channel_id).await;
    assert!(
        remote.join("agent-exec-marker").is_file(),
        "agent exec should write on the host cwd"
    );
    assert!(
        !decoy_marker.is_file(),
        "agent exec must not create a local decoy file"
    );
    assert!(
        !local_cwd_marker.is_file(),
        "agent exec must not create a file in the local cwd"
    );

    let ssh = crate::commands::fs::parse_ssh_project_root(&root).expect("uri");
    match probe_remote_program(&ssh, "rg").await {
        Ok(()) => {
            let found = workspace_grep(WorkspaceGrepRequest {
                project_root: root.clone(),
                pattern: "REMOTE_NEEDLE".into(),
                path: None,
                glob: None,
                case_insensitive: None,
                max_results: Some(20),
                regex: Some(false),
                whole_word: None,
                exclude_glob: None,
                project_roots: None,
            })
            .await
            .expect("remote rg");
            assert!(
                found
                    .matches
                    .iter()
                    .any(|item| item.line.contains("REMOTE_NEEDLE")),
                "rg matches were {:?}",
                found.matches
            );
            assert!(
                found
                    .matches
                    .iter()
                    .all(|item| !item.line.contains("LOCAL_NEEDLE")),
                "rg used the decoy: {:?}",
                found.matches
            );
        }
        Err(err) => {
            assert_eq!(err, missing_program("rg", hostname));
            let grep_err = workspace_grep(WorkspaceGrepRequest {
                project_root: root.clone(),
                pattern: "REMOTE_NEEDLE".into(),
                path: None,
                glob: None,
                case_insensitive: None,
                max_results: Some(20),
                regex: Some(false),
                whole_word: None,
                exclude_glob: None,
                project_roots: None,
            })
            .await
            .expect_err("missing rg");
            assert_eq!(grep_err, "rg is not installed on 127.0.0.1.");
        }
    }

    let missing = probe_remote_program(&ssh, "vixl-no-such-program")
        .await
        .expect_err("missing program");
    assert_eq!(
        missing,
        missing_program("vixl-no-such-program", hostname)
    );

}
