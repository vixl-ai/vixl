use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::commands::fs::{
    fs_list_dir, fs_read_file, fs_read_file_command, fs_stat, fs_write_file, WorkspaceRootArg,
};
use crate::commands::ssh::{
    clear_sessions_for_tests, connect, disconnect, insert_test_session, session_key,
    SshConnectRequest, SshPaths, SshSessionStatus, SESSION_TEST_LOCK,
};

use super::remote::{force_next_write_size_mismatch, parse_ssh_project_root};

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

#[test]
fn local_root_still_uses_std_fs() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_string_lossy().to_string();
    fs_write_file(
        root.clone(),
        "local.txt".into(),
        "hello\n".into(),
        None,
        None,
    )
    .expect("local write");
    assert_eq!(
        fs::read_to_string(dir.path().join("local.txt")).expect("read local"),
        "hello\n"
    );
    let listed = fs_list_dir(root, ".".into(), None, None).expect("list");
    assert!(listed.iter().any(|entry| entry.name == "local.txt"));
}

#[tokio::test]
async fn read_command_fails_fast_when_the_master_is_dead() {
    let err = fs_read_file_command(
        "ssh://aidanhibbard@vixl-read-decoy.example/tmp/proj".into(),
        "AGENTS.md".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .expect_err("dead master");
    assert!(
        err.contains("vixl-read-decoy.example is not connected."),
        "got {err}"
    );
}

#[test]
fn opening_slash_is_refused_without_sftp() {
    let err = fs_read_file(
        "ssh://aidanhibbard@eva.local/".into(),
        "etc/passwd".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("slash");
    assert_eq!(err, "Opening / on eva.local is refused.");
}

#[test]
fn path_traversal_nul_and_newline_are_rejected() {
    let root = "ssh://aidanhibbard@eva.local/home/aidanhibbard/proj";
    let parent = fs_read_file(
        root.into(),
        "../secret".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("parent");
    assert_eq!(parent, "Path traversal is not allowed");

    let absolute = fs_read_file(
        root.into(),
        "/etc/passwd".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("absolute");
    assert_eq!(absolute, "Path must be relative to the project root");

    let nul = fs_read_file(root.into(), "foo\0bar".into(), None, None, None, None, None)
        .expect_err("nul");
    assert_eq!(nul, "Name rejected on eva.local.");

    let newline =
        fs_write_file(root.into(), "foo\nbar".into(), "x".into(), None, None).expect_err("newline");
    assert_eq!(newline, "Name rejected on eva.local.");
}

#[test]
fn ssh_root_does_not_touch_uri_as_local_path() {
    let decoy = PathBuf::from("ssh://aidanhibbard@host.example/tmp/proj");
    let _ = fs::remove_dir_all(&decoy);
    let err = fs_write_file(
        "ssh://aidanhibbard@host.example/tmp/proj".into(),
        "file.txt".into(),
        "REMOTE\n".into(),
        None,
        None,
    )
    .expect_err("no master");
    assert!(err.contains("host.example is unreachable."), "got {err}");
    assert!(
        !decoy.exists(),
        "URI must not be created as a local directory"
    );
}

#[test]
fn sensitive_path_blocks_before_any_remote_write() {
    let err = fs_write_file(
        "ssh://aidanhibbard@host.example/tmp/proj".into(),
        ".env".into(),
        "SECRET=1\n".into(),
        None,
        None,
    )
    .expect_err("sensitive");
    assert_eq!(err, "Sensitive path blocked");
    assert!(!Path::new("ssh://aidanhibbard@host.example/tmp/proj").exists());
}

#[test]
fn sensitive_path_allow_true_still_requires_a_live_master() {
    let err = fs_write_file(
        "ssh://aidanhibbard@host.example/tmp/proj".into(),
        ".env".into(),
        "SECRET=1\n".into(),
        Some(true),
        None,
    )
    .expect_err("no master");
    assert!(err.contains("host.example is unreachable."), "got {err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn dead_master_does_not_reuse_a_cached_sftp_channel() {
    let _lock = SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    let user = "aidanhibbard";
    let hostname = "vixl-dead-sftp.example";
    let port = 2222u16;
    let key = session_key(user, hostname, port);
    let mut child =
        super::remote::insert_silent_sftp_for_test(key.clone(), hostname.to_string()).await;
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
    insert_test_session(
        SshSessionStatus {
            user: user.to_string(),
            hostname: hostname.to_string(),
            port,
            destination: hostname.to_string(),
            state: "disconnected".to_string(),
            line: format!("{hostname} is not connected."),
            last_error: None,
            master_alive: false,
        },
        paths,
        dir.path().join("cm-missing"),
    )
    .await;
    let started = std::time::Instant::now();
    let err = fs_read_file(
        format!("ssh://{user}@{hostname}/tmp/proj"),
        "README.md".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("dead cached channel");
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "cached channel was reused"
    );
    assert!(
        err.contains("vixl-dead-sftp.example is not connected."),
        "got {err}"
    );
    let _ = child.kill().await;
    let _ = child.wait().await;
    clear_sessions_for_tests().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dead_master_fails_and_names_the_host() {
    let _lock = SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
    insert_test_session(
        SshSessionStatus {
            user: "aidanhibbard".to_string(),
            hostname: "eva.local".to_string(),
            port: 22,
            destination: "eva".to_string(),
            state: "disconnected".to_string(),
            line: "eva.local is not connected".to_string(),
            last_error: None,
            master_alive: false,
        },
        paths,
        dir.path().join("cm-missing"),
    )
    .await;
    let err = fs_read_file(
        "ssh://aidanhibbard@eva.local/home/aidanhibbard/proj".into(),
        "README.md".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("dead");
    assert!(err.contains("eva.local is unreachable."), "got {err}");
    clear_sessions_for_tests().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn disposable_sshd_remote_fs() {
    let _lock = SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    if !Path::new(SSHD_BIN).exists() {
        eprintln!("{SSHD_BIN} is not present. Kept unit tests. No disposable sshd.");
        return;
    }
    let user = whoami();
    let short_root = PathBuf::from(format!("/tmp/vxf{}", std::process::id()));
    let _ = fs::remove_dir_all(&short_root);
    fs::create_dir_all(&short_root).expect("short temp dir");
    let dir_guard = ShortDir(short_root.clone());
    let port = 23111u16;
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
                    run_live_sftp_cases(&user, port, &short_root);
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

fn run_live_sftp_cases(user: &str, port: u16, short_root: &Path) {
    let remote = short_root.join("proj");
    fs::create_dir_all(&remote).expect("remote proj");
    let decoy = tempfile::tempdir().expect("decoy");
    fs::write(decoy.path().join("file.txt"), "LOCAL\n").expect("decoy file");
    fs::write(remote.join("file.txt"), "REMOTE\n").expect("remote file");
    let root = ssh_root(user, port, &remote);

    let listed = fs_list_dir(root.clone(), ".".into(), None, None).expect("list");
    assert!(
        listed.iter().any(|entry| entry.name == "file.txt"),
        "listing was {listed:?}"
    );
    let empty = remote.join("empty");
    fs::create_dir_all(&empty).expect("empty dir");
    let empty_list = fs_list_dir(root.clone(), "empty".into(), None, None).expect("empty");
    assert!(empty_list.is_empty(), "empty dir must be an empty list");

    let read = fs_read_file(
        root.clone(),
        "file.txt".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect("read");
    assert_eq!(read.content, "REMOTE");
    assert_eq!(
        fs::read_to_string(decoy.path().join("file.txt")).expect("decoy unchanged"),
        "LOCAL\n"
    );

    fs_write_file(
        root.clone(),
        "file.txt".into(),
        "NEW\r\n".into(),
        None,
        None,
    )
    .expect("write crlf");
    assert_eq!(
        fs::read_to_string(remote.join("file.txt")).expect("remote after write"),
        "NEW\r\n"
    );
    assert_eq!(
        fs::read_to_string(decoy.path().join("file.txt")).expect("decoy after write"),
        "LOCAL\n"
    );

    fs::write(remote.join("keep.txt"), "PREVIOUS\n").expect("previous");
    force_next_write_size_mismatch();
    let mismatch = fs_write_file(
        root.clone(),
        "keep.txt".into(),
        "REPLACED\n".into(),
        None,
        None,
    )
    .expect_err("size mismatch");
    assert!(
        mismatch.contains("Size on 127.0.0.1 does not match the bytes sent."),
        "got {mismatch}"
    );
    assert_eq!(
        fs::read_to_string(remote.join("keep.txt")).expect("previous stayed"),
        "PREVIOUS\n"
    );
    let leftovers: Vec<_> = fs::read_dir(&remote)
        .expect("read dir")
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".vixl-write-")
        })
        .collect();
    assert!(leftovers.is_empty(), "temp file must be removed");

    let outside = short_root.join("outside");
    fs::create_dir_all(&outside).expect("outside");
    fs::write(outside.join("outside.txt"), "nope\n").expect("outside file");
    std::os::unix::fs::symlink(&outside, remote.join("escape")).expect("symlink");
    let escape = fs_read_file(
        root.clone(),
        "escape/outside.txt".into(),
        None,
        None,
        None,
        None,
        None,
    )
    .expect_err("escape");
    assert!(
        escape.contains("Path escapes project root on 127.0.0.1."),
        "got {escape}"
    );

    let broken = remote.join("broken");
    std::os::unix::fs::symlink(remote.join("missing-target"), &broken).expect("broken link");
    assert!(fs::symlink_metadata(&broken)
        .expect("broken meta")
        .file_type()
        .is_symlink());
    let listing = fs_list_dir(root.clone(), ".".into(), None, None).expect("list after broken");
    let broken_entry = listing.iter().find(|entry| entry.name == "broken");
    assert!(
        broken_entry.is_some(),
        "SFTP listing omitted broken symlink: {listing:?}"
    );
    let broken_err = fs_read_file(root.clone(), "broken".into(), None, None, None, None, None)
        .expect_err("broken");
    assert!(
        broken_err.contains("Broken symlink on 127.0.0.1."),
        "got {broken_err} listed as {:?}",
        broken_entry.map(|entry| entry.kind.as_str())
    );

    let fifo = remote.join("pipe");
    #[cfg(unix)]
    {
        let _ = nix_mkfifo(&fifo);
        if fifo.exists() {
            let fifo_err = fs_read_file(root.clone(), "pipe".into(), None, None, None, None, None)
                .expect_err("fifo");
            assert!(
                fifo_err.contains("Not a regular file on 127.0.0.1."),
                "got {fifo_err}"
            );
        }
    }

    fs::write(remote.join(".env"), "OLD=1\n").expect("env");
    let blocked = fs_write_file(root.clone(), ".env".into(), "NEW=1\n".into(), None, None)
        .expect_err("sensitive write");
    assert_eq!(blocked, "Sensitive path blocked");
    assert_eq!(
        fs::read_to_string(remote.join(".env")).expect("env unchanged"),
        "OLD=1\n"
    );
    fs_write_file(
        root.clone(),
        ".env".into(),
        "NEW=1\n".into(),
        Some(true),
        None,
    )
    .expect("sensitive allowed");
    assert_eq!(
        fs::read_to_string(remote.join(".env")).expect("env updated"),
        "NEW=1\n"
    );

    let _parsed = parse_ssh_project_root(&root).expect("live uri");
    let _ = WorkspaceRootArg {
        slug: "eva".to_string(),
        path: root.clone(),
    };

    let missing = fs_stat(root.clone(), "no-such".into(), None, None).expect("stat missing");
    assert!(!missing.exists);
}

fn nix_mkfifo(path: &Path) -> Result<(), ()> {
    let cstr = std::ffi::CString::new(path.to_string_lossy().as_bytes()).map_err(|_| ())?;
    let rc = unsafe { libc::mkfifo(cstr.as_ptr(), 0o600) };
    if rc == 0 {
        Ok(())
    } else {
        Err(())
    }
}
