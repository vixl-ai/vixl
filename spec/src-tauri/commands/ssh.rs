use std::path::Path;

use app_lib::commands::keychain::{
    deny_ssh_vault_from_webview, webview_secret_command_prepare, SSH_PASSPHRASE_PREFIX,
    SSH_PASSWORD_PREFIX,
};
use app_lib::commands::ssh::{
    also_add_new_vixl_lines, argv_contains_forbidden, build_ssh_argv, classify_askpass,
    encode_helper_stdio, remove_vixl_known_host_lines, require_socket_path_len,
    validate_destination, ArgvRequest, AskpassKind, AskpassResponse, AuthAttempt,
    ControlMasterMode, SecretDisposition, SecretKind, SshInvocation, SshPaths, TtyMode,
    FIXTURE_SSH_PASSWORD, PIN_OPTIONS, SSH_BIN,
};

fn sample_argv(invocation: SshInvocation, tty: TtyMode, password_only: bool) -> Vec<String> {
    build_ssh_argv(ArgvRequest {
        destination: "eva",
        control_path: Some("/Users/test/.vixl/ssh/cm/abcdabcdabcdabcd"),
        control_master: match invocation {
            SshInvocation::Master => ControlMasterMode::Yes,
            _ => ControlMasterMode::No,
        },
        tty,
        vixl_known_hosts: "/Users/test/.vixl/ssh/known_hosts",
        user_known_hosts: "/Users/test/.ssh/known_hosts",
        password_only,
        port: Some(22),
        identity_file: None,
        invocation,
        config_file: None,
    })
    .as_command_line()
}

#[test]
fn argv_contains_pins_and_does_not_contain_forbidden_or_secret() {
    let argv = sample_argv(SshInvocation::Master, TtyMode::No, false);
    assert_eq!(argv[0], SSH_BIN);
    let joined = argv.join(" ");
    for pin in PIN_OPTIONS {
        assert!(joined.contains(pin), "missing {pin}");
    }
    assert!(joined.contains("RequestTTY=no"));
    assert!(joined.contains("ControlPersist=no"));
    assert!(!joined.contains("-A"));
    assert!(!joined.contains("ControlPersist=yes"));
    assert!(!joined.contains(FIXTURE_SSH_PASSWORD));
    assert!(!argv_contains_forbidden(&argv));
}

#[test]
fn path_longer_than_103_bytes_refuses_before_ssh_starts() {
    let long = "a".repeat(104);
    let err = require_socket_path_len(Path::new(&long), "eva.local").unwrap_err();
    assert!(err.contains("SSH socket path is too long for eva.local"));
    assert!(err.contains("104 bytes"));
    assert!(err.contains("103"));
}

#[test]
fn confirm_vs_secret_classification() {
    let confirm = classify_askpass(
        Some("confirm"),
        "Are you sure you want to continue connecting?",
    );
    assert_eq!(confirm.kind, AskpassKind::Confirm);
    let secret = classify_askpass(None, "password:");
    assert_eq!(secret.kind, AskpassKind::Secret);
    assert_eq!(secret.secret_kind, Some(SecretKind::Password));
}

#[test]
fn cancel_does_not_produce_a_password() {
    let (code, stdout) = encode_helper_stdio(&AskpassResponse::Cancel);
    assert_eq!(code, 1);
    assert!(stdout.is_empty());
    let (code, stdout) = encode_helper_stdio(&AskpassResponse::Submit(String::new()));
    assert_eq!(code, 0);
    assert_eq!(stdout, b"\n");
}

#[test]
fn saved_secret_is_attempted_once() {
    let mut attempt = AuthAttempt::new(Some(FIXTURE_SSH_PASSWORD.to_string()), None);
    match attempt.take_secret(SecretKind::Password) {
        SecretDisposition::Submit(value) => assert_eq!(value, FIXTURE_SSH_PASSWORD),
        other => panic!("expected submit got {other:?}"),
    }
    match attempt.take_secret(SecretKind::Password) {
        SecretDisposition::AskUser { .. } => {}
        other => panic!("expected ask user got {other:?}"),
    }
}

#[test]
fn get_secret_set_secret_delete_secret_reject_ssh_prefixes() {
    let password = format!("{SSH_PASSWORD_PREFIX}aidanhibbard@eva.local:22");
    let passphrase = format!("{SSH_PASSPHRASE_PREFIX}/tmp/id_ed25519");
    for key in [password.as_str(), passphrase.as_str()] {
        assert!(deny_ssh_vault_from_webview(key).is_err());
        assert!(webview_secret_command_prepare(key).is_err());
    }
}

#[test]
fn changed_host_key_does_not_open_a_password_submission() {
    let mut attempt = AuthAttempt::new(Some(FIXTURE_SSH_PASSWORD.to_string()), None);
    attempt.note_host_key_changed();
    assert_eq!(
        attempt.take_secret(SecretKind::Password),
        SecretDisposition::Cancel
    );
}

#[test]
fn new_key_write_goes_to_vixl_known_hosts_only_unless_also_add() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = SshPaths::from_roots(dir.path().join("vixl-ssh"), dir.path().join("user-ssh"));
    std::fs::create_dir_all(&paths.vixl_ssh_dir).expect("vixl");
    std::fs::create_dir_all(&paths.user_ssh_dir).expect("user");
    let line = "127.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureHostKeyNotReal";
    std::fs::write(paths.known_hosts(), format!("{line}\n")).expect("write vixl");
    also_add_new_vixl_lines(&paths, "", false).expect("skip also add");
    assert!(!paths.user_known_hosts().exists());
    also_add_new_vixl_lines(&paths, "", true).expect("also add");
    let user = std::fs::read_to_string(paths.user_known_hosts()).expect("user");
    assert!(user.contains(line));
}

#[test]
fn remove_vixl_line_leaves_user_known_hosts() {
    let dir = tempfile::tempdir().expect("tempdir");
    let vixl = dir.path().join("vixl_known_hosts");
    let user = dir.path().join("user_known_hosts");
    std::fs::write(
        &vixl,
        "eva.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIVixl\n",
    )
    .expect("vixl");
    std::fs::write(
        &user,
        "eva.local ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIUser\n",
    )
    .expect("user");
    remove_vixl_known_host_lines(&vixl, "eva.local", 22).expect("remove");
    let vixl_text = std::fs::read_to_string(&vixl).expect("read vixl");
    let user_text = std::fs::read_to_string(&user).expect("read user");
    assert!(!vixl_text.contains("IVixl"));
    assert!(user_text.contains("IUser"));
}

#[test]
fn destination_validation_rejects_password_and_command() {
    assert!(validate_destination("").is_err());
    assert!(validate_destination("ssh eva").is_err());
    assert!(validate_destination("user:not-a-real-password@host").is_err());
    assert_eq!(validate_destination("eva").expect("alias"), "eva");
}
