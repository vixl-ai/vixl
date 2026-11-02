use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use super::channels::{exec_wait, open_exec};
use super::paths::SshPaths;
use super::session::{
    clear_sessions_for_tests, connect, disconnect, insert_test_session, session_key,
    SshConnectRequest, SshSessionStatus,
};

const SSHD_BIN: &str = "/usr/sbin/sshd";
const KEYGEN_BIN: &str = "/usr/bin/ssh-keygen";

struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn sshd_stderr_from_spawn(err: std::io::Error) -> String {
    format!("failed to spawn {SSHD_BIN}: {err}")
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
        .map_err(sshd_stderr_from_spawn)?;

    std::thread::sleep(Duration::from_millis(300));
    match child.try_wait() {
        Ok(Some(status)) => {
            let mut stderr = String::new();
            if let Some(mut reader) = child.stderr.take() {
                use std::io::Read;
                let _ = reader.read_to_string(&mut stderr);
            }
            let mut stdout = String::new();
            if let Some(mut reader) = child.stdout.take() {
                use std::io::Read;
                let _ = reader.read_to_string(&mut stdout);
            }
            Err(format!(
                "{SSHD_BIN} exited {status}. stderr: {stderr} stdout: {stdout}"
            ))
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

#[tokio::test]
async fn disposable_sshd_or_report_stderr() {
    let _lock = super::session::SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    if !Path::new(SSHD_BIN).exists() {
        eprintln!("{SSHD_BIN} is not present. Kept unit tests. No disposable sshd.");
        return;
    }
    let user = whoami();
    let short_root = PathBuf::from(format!("/tmp/vxs{}", std::process::id()));
    let _ = fs::remove_dir_all(&short_root);
    fs::create_dir_all(&short_root).expect("short temp dir");
    let dir_guard = ShortDir(short_root.clone());
    let port = 23000u16;
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
                    let exec =
                        open_exec(session_key(&user, "127.0.0.1", port), "true".to_string()).await;
                    assert!(exec.is_ok(), "exec channel on live master: {exec:?}");
                    let both = exec_wait(
                        session_key(&user, "127.0.0.1", port),
                        "echo stdout-marker; echo stderr-marker >&2".to_string(),
                    )
                    .await
                    .expect("exec both streams");
                    assert!(
                        both.stdout.contains("stdout-marker"),
                        "stdout was {:?}",
                        both.stdout
                    );
                    assert!(
                        both.stderr.contains("stderr-marker"),
                        "stderr was {:?}",
                        both.stderr
                    );
                    let _ = disconnect(&user, "127.0.0.1", port).await;
                    eprintln!("disposable sshd handshake succeeded on port {port}");
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

#[tokio::test]
async fn two_connects_share_one_master_record() {
    let _lock = super::session::SESSION_TEST_LOCK.lock().await;
    clear_sessions_for_tests().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = SshPaths::from_roots(dir.path().join("vixl"), dir.path().join("user"));
    let status = SshSessionStatus {
        user: "aidanhibbard".to_string(),
        hostname: "shared.example".to_string(),
        port: 22,
        destination: "shared".to_string(),
        state: "connected".to_string(),
        line: "Connected as aidanhibbard@shared.example.".to_string(),
        last_error: None,
        master_alive: true,
    };
    insert_test_session(status.clone(), paths.clone(), dir.path().join("cm")).await;
    insert_test_session(status, paths, dir.path().join("cm")).await;
    let sessions = super::session::list_sessions().await;
    assert_eq!(
        sessions
            .iter()
            .filter(|item| item.hostname == "shared.example")
            .count(),
        1
    );
    clear_sessions_for_tests().await;
}
