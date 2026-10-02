use std::path::PathBuf;

use app_lib::commands::shell::{is_reveal_path_allowed, pty_shell_args, resolve_pty_shell};

fn dummy_user_vixl() -> PathBuf {
    PathBuf::from("/nonexistent-vixl-user-dir")
}

#[cfg(unix)]
#[test]
fn pty_shell_matches_shell_env_or_zsh() {
    let resolved = resolve_pty_shell();
    match std::env::var("SHELL") {
        Ok(shell) => assert_eq!(resolved, shell),
        Err(_) => assert_eq!(resolved, "/bin/zsh"),
    }
}

#[cfg(unix)]
#[test]
fn pty_shell_args_includes_login_flag() {
    assert!(pty_shell_args().contains(&"-l"));
}

#[test]
fn reveal_allows_path_under_vixl_temp() {
    let dir = std::env::temp_dir().join("vixl").join("screenshots");
    std::fs::create_dir_all(&dir).expect("create vixl temp screenshots dir");
    let file = dir.join("reveal-allowlist-test.png");
    std::fs::write(&file, b"").expect("write temp screenshot fixture");
    let canonical = file.canonicalize().expect("canonicalize temp screenshot");
    assert!(is_reveal_path_allowed(&canonical, None, &dummy_user_vixl(),));
}

#[test]
fn reveal_rejects_path_under_etc() {
    let etc = PathBuf::from("/etc");
    let canonical = etc.canonicalize().unwrap_or(etc);
    assert!(!is_reveal_path_allowed(
        &canonical,
        None,
        &dummy_user_vixl(),
    ));
}

#[test]
fn reveal_rejects_generic_temp_dir() {
    let temp = std::env::temp_dir();
    let canonical = temp.canonicalize().unwrap_or(temp);
    assert!(!is_reveal_path_allowed(
        &canonical,
        None,
        &dummy_user_vixl(),
    ));
}
