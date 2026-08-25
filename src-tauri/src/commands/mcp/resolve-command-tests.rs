use super::*;
use std::fs;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(unix)]
fn write_fake_bin(dir: &Path, name: &str) -> PathBuf {
    fs::create_dir_all(dir).expect("temp dir");
    let path = dir.join(name);
    fs::write(&path, "#!/bin/sh\n").expect("write fake bin");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
    path
}

#[cfg(unix)]
fn unique_dir(label: &str) -> PathBuf {
    env::temp_dir().join(format!("vixl-resolve-{label}-{}", uuid::Uuid::new_v4()))
}

#[cfg(unix)]
#[test]
fn current_path_wins_over_login_and_dirs() {
    let current_dir = unique_dir("current");
    let login_dir = unique_dir("login");
    let extra_dir = unique_dir("extra");
    let current_bin = write_fake_bin(&current_dir, "vixl-npx");
    write_fake_bin(&login_dir, "vixl-npx");
    write_fake_bin(&extra_dir, "vixl-npx");

    let found = resolve_on_sources(
        "vixl-npx",
        Some(current_dir.as_os_str()),
        Some(login_dir.as_os_str()),
        &[extra_dir.clone()],
        None,
    )
    .expect("resolve");
    assert_eq!(found, current_bin);

    let _ = fs::remove_dir_all(current_dir);
    let _ = fs::remove_dir_all(login_dir);
    let _ = fs::remove_dir_all(extra_dir);
}

#[cfg(unix)]
#[test]
fn login_path_used_when_current_path_misses() {
    let login_dir = unique_dir("login-only");
    let extra_dir = unique_dir("extra-unused");
    let login_bin = write_fake_bin(&login_dir, "vixl-npx");
    write_fake_bin(&extra_dir, "vixl-npx");

    let found = resolve_on_sources(
        "vixl-npx",
        Some(OsStr::new("")),
        Some(login_dir.as_os_str()),
        &[extra_dir.clone()],
        None,
    )
    .expect("resolve");
    assert_eq!(found, login_bin);

    let _ = fs::remove_dir_all(login_dir);
    let _ = fs::remove_dir_all(extra_dir);
}

#[cfg(unix)]
#[test]
fn common_dirs_used_when_path_vars_miss() {
    let extra_dir = unique_dir("dirs");
    let extra_bin = write_fake_bin(&extra_dir, "vixl-npx");

    let found = resolve_on_sources(
        "vixl-npx",
        Some(OsStr::new("")),
        Some(OsStr::new("")),
        &[extra_dir.clone()],
        None,
    )
    .expect("resolve");
    assert_eq!(found, extra_bin);

    let _ = fs::remove_dir_all(extra_dir);
}

#[cfg(unix)]
#[test]
fn portable_sibling_is_last_fallback() {
    let portable_dir = unique_dir("portable");
    let portable_bin = write_fake_bin(&portable_dir, "vixl-npx");

    let found = resolve_on_sources(
        "vixl-npx",
        Some(OsStr::new("")),
        Some(OsStr::new("")),
        &[],
        Some(portable_bin.clone()),
    )
    .expect("resolve");
    assert_eq!(found, portable_bin);

    let _ = fs::remove_dir_all(portable_dir);
}

#[test]
fn missing_command_error_names_basename() {
    let error = resolve_on_sources(
        "vixl-missing-npx",
        Some(OsStr::new("")),
        Some(OsStr::new("")),
        &[],
        None,
    )
    .expect_err("missing");
    assert!(error.contains("vixl-missing-npx"));
}
