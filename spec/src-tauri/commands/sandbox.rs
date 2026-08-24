#![cfg(target_os = "macos")]

use app_lib::commands::sandbox::{generate_seatbelt_profile, path_ancestors};

#[test]
fn path_ancestors_home() {
  assert_eq!(
    path_ancestors("/Users/aidanhibbard"),
    vec!["/Users".to_string()]
  );
}

#[test]
fn path_ancestors_project_root() {
  assert_eq!(
    path_ancestors("/Users/aidanhibbard/Documents/GitHub/vixl"),
    vec![
      "/Users/aidanhibbard/Documents/GitHub".to_string(),
      "/Users/aidanhibbard/Documents".to_string(),
      "/Users/aidanhibbard".to_string(),
      "/Users".to_string(),
    ]
  );
}

#[test]
fn path_ancestors_skips_relative_and_empty() {
  assert!(path_ancestors("").is_empty());
  assert!(path_ancestors("relative/path").is_empty());
  assert!(path_ancestors("/").is_empty());
}

#[test]
fn profile_allows_root_directory_read() {
  let profile = generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
  assert!(
    profile.contains("(allow file-read* (literal \"/\"))"),
    "profile must allow reading the filesystem root for modern macOS process startup"
  );
}

#[test]
fn profile_allows_macos_symlink_reads() {
  let profile = generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
  for path in ["/var", "/etc", "/tmp"] {
    let rule = format!("(allow file-read* (literal \"{path}\"))");
    assert!(
      profile.contains(&rule),
      "profile missing macOS symlink read rule: {rule}"
    );
  }
}

#[test]
fn profile_includes_network_rule_when_enabled() {
  let with_network =
    generate_seatbelt_profile(true, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
  let without_network =
    generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
  assert!(with_network.contains("(allow network*)"));
  assert!(!without_network.contains("(allow network*)"));
}

#[test]
fn profile_allows_home_ancestors_read() {
  let profile =
    generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
  assert!(
    profile.contains("(allow file-read* (literal \"/Users\"))"),
    "profile must allow reading HOME ancestors for Node/npm realpath"
  );
}

#[test]
fn profile_allows_project_root_ancestors_read() {
  let profile = generate_seatbelt_profile(
    false,
    "/Users/aidanhibbard",
    "/Users/aidanhibbard/Documents/GitHub/vixl",
  );
  for ancestor in [
    "/Users",
    "/Users/aidanhibbard",
    "/Users/aidanhibbard/Documents",
    "/Users/aidanhibbard/Documents/GitHub",
  ] {
    let rule = format!("(allow file-read* (literal \"{ancestor}\"))");
    assert!(
      profile.contains(&rule),
      "profile missing ancestor read rule: {rule}"
    );
  }
}

#[test]
fn sandbox_exec_echo_succeeds_with_profile() {
  use std::env;
  use std::process::Command;

  let home = env::var("HOME").unwrap_or_default();
  let tmpdir_raw = env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
  let tmpdir = std::fs::canonicalize(&tmpdir_raw)
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or(tmpdir_raw);
  let project_root = env::current_dir()
    .expect("current dir")
    .to_string_lossy()
    .to_string();

  let profile = generate_seatbelt_profile(false, &home, &project_root);

  let output = Command::new("/usr/bin/sandbox-exec")
    .arg("-D")
    .arg(format!("HOME={home}"))
    .arg("-D")
    .arg(format!("PROJECT_ROOT={project_root}"))
    .arg("-D")
    .arg(format!("TMPDIR={tmpdir}"))
    .arg("-p")
    .arg(&profile)
    .arg("sh")
    .arg("-c")
    .arg("echo hello")
    .output()
    .expect("sandbox-exec spawn");

  assert!(
    output.status.success(),
    "sandbox-exec failed: status={} stderr={}",
    output.status,
    String::from_utf8_lossy(&output.stderr)
  );
  assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
}

#[test]
fn sandbox_cc_version_succeeds_with_profile() {
  use std::env;
  use std::process::Command;

  let home = env::var("HOME").unwrap_or_default();
  let tmpdir_raw = env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
  let tmpdir = std::fs::canonicalize(&tmpdir_raw)
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or(tmpdir_raw);
  let project_root = env::current_dir()
    .expect("current dir")
    .to_string_lossy()
    .to_string();

  let profile = generate_seatbelt_profile(false, &home, &project_root);

  let output = Command::new("/usr/bin/sandbox-exec")
    .arg("-D")
    .arg(format!("HOME={home}"))
    .arg("-D")
    .arg(format!("PROJECT_ROOT={project_root}"))
    .arg("-D")
    .arg(format!("TMPDIR={tmpdir}"))
    .arg("-p")
    .arg(&profile)
    .arg("cc")
    .arg("--version")
    .output()
    .expect("sandbox-exec spawn");

  let stdout = String::from_utf8_lossy(&output.stdout);
  let stderr = String::from_utf8_lossy(&output.stderr);
  assert!(
    output.status.success(),
    "sandbox-exec cc --version failed: status={} stderr={}",
    output.status,
    stderr
  );
  assert!(
    stdout.to_lowercase().contains("clang"),
    "expected clang in cc --version stdout, got: {stdout}"
  );
}
