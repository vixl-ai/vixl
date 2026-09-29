#![cfg(target_os = "macos")]

use app_lib::commands::sandbox::{
    generate_seatbelt_profile, generate_seatbelt_profile_with, path_ancestors,
};

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
    let profile =
        generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
    assert!(
        profile.contains("(allow file-read* (literal \"/\"))"),
        "profile must allow reading the filesystem root for modern macOS process startup"
    );
}

#[test]
fn profile_allows_macos_symlink_reads() {
    let profile =
        generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
    for path in ["/var", "/private/var", "/private", "/etc", "/tmp"] {
        let rule = format!("(allow file-read* (literal \"{path}\"))");
        assert!(
            profile.contains(&rule),
            "profile missing macOS symlink read rule: {rule}"
        );
    }
}

#[test]
fn profile_denies_dotenv_writes_and_allows_templates() {
    let profile =
        generate_seatbelt_profile(false, "/Users/aidanhibbard", "/Users/aidanhibbard/proj");
    let project_allow = "(allow file-write* (subpath (param \"PROJECT_ROOT\")))";
    let env_deny = "(regex #\"/\\.env(\\.[^/]*)?$\")";
    let template_allow = "(regex #\"/\\.env\\.(example|sample|template)$\")";

    let allow_pos = profile
        .find(project_allow)
        .expect("profile must allow writes under PROJECT_ROOT");
    let deny_pos = profile
        .find(env_deny)
        .expect("profile missing .env write deny regex");
    let template_pos = profile
        .find(template_allow)
        .expect("profile missing env template write allow regex");

    assert!(
        profile.contains("(deny file-write*")
            && profile.contains("(require-all")
            && profile.contains("(subpath (param \"PROJECT_ROOT\"))"),
        "env deny must combine PROJECT_ROOT subpath with regex"
    );
    assert!(
        allow_pos < deny_pos,
        "env write deny must come after PROJECT_ROOT write allow"
    );
    assert!(
        deny_pos < template_pos,
        "env template allow must come after the .env write deny"
    );
}

#[test]
fn sandbox_exec_blocks_dotenv_write_and_allows_templates() {
    use std::env;
    use std::process::Command;

    let home = env::var("HOME").unwrap_or_default();
    let tmpdir_raw = env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
    let tmpdir = std::fs::canonicalize(&tmpdir_raw)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(tmpdir_raw);
    let project_root_raw = format!("/tmp/vixl-sandbox-env-{}", std::process::id());
    std::fs::create_dir_all(&project_root_raw).expect("create project root");
    let project_root = std::fs::canonicalize(&project_root_raw)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(project_root_raw);

    let profile = generate_seatbelt_profile(false, &home, &project_root);
    let run = |filename: &str| {
        Command::new("/usr/bin/sandbox-exec")
            .arg("-D")
            .arg(format!("HOME={home}"))
            .arg("-D")
            .arg(format!("PROJECT_ROOT={project_root}"))
            .arg("-D")
            .arg(format!("TMPDIR={tmpdir}"))
            .arg("-p")
            .arg(&profile)
            .current_dir(&project_root)
            .arg("sh")
            .arg("-c")
            .arg(format!("printf 'x' > '{filename}'"))
            .output()
            .expect("sandbox-exec spawn")
    };

    let env_output = run(".env");
    let local_output = run(".env.local");
    let example_output = run(".env.example");
    let sample_output = run(".env.sample");
    let template_output = run(".env.template");
    let notes_output = run("notes.txt");

    let env_path = format!("{project_root}/.env");
    let local_path = format!("{project_root}/.env.local");
    let example_path = format!("{project_root}/.env.example");
    let sample_path = format!("{project_root}/.env.sample");
    let template_path = format!("{project_root}/.env.template");
    let notes_path = format!("{project_root}/notes.txt");
    let env_exists = std::path::Path::new(&env_path).exists();
    let local_exists = std::path::Path::new(&local_path).exists();
    let example_wrote = std::fs::read_to_string(&example_path);
    let sample_wrote = std::fs::read_to_string(&sample_path);
    let template_wrote = std::fs::read_to_string(&template_path);
    let notes_wrote = std::fs::read_to_string(&notes_path);
    let _ = std::fs::remove_dir_all(&project_root);

    assert!(
        !env_output.status.success(),
        "sandbox should block writing .env: stderr={}",
        String::from_utf8_lossy(&env_output.stderr)
    );
    assert!(!env_exists);
    assert!(
        !local_output.status.success(),
        "sandbox should block writing .env.local: stderr={}",
        String::from_utf8_lossy(&local_output.stderr)
    );
    assert!(!local_exists);
    assert!(
        example_output.status.success(),
        "sandbox should allow writing .env.example: stderr={}",
        String::from_utf8_lossy(&example_output.stderr)
    );
    assert_eq!(example_wrote.expect(".env.example"), "x");
    assert!(
        sample_output.status.success(),
        "sandbox should allow writing .env.sample: stderr={}",
        String::from_utf8_lossy(&sample_output.stderr)
    );
    assert_eq!(sample_wrote.expect(".env.sample"), "x");
    assert!(
        template_output.status.success(),
        "sandbox should allow writing .env.template: stderr={}",
        String::from_utf8_lossy(&template_output.stderr)
    );
    assert_eq!(template_wrote.expect(".env.template"), "x");
    assert!(
        notes_output.status.success(),
        "sandbox should still allow ordinary project writes: stderr={}",
        String::from_utf8_lossy(&notes_output.stderr)
    );
    assert_eq!(notes_wrote.expect("notes.txt"), "x");
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

#[test]
fn sandbox_exec_resolves_and_writes_under_tmpdir() {
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
    let marker = std::path::Path::new(&tmpdir)
        .join(format!("vixl-sandbox-tmp-write-{}", std::process::id()));
    let _ = std::fs::remove_file(&marker);

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
        .env("TMPDIR", &tmpdir)
        .env("VIXL_SANDBOX_MARKER", &marker)
        .arg("/usr/bin/perl")
        .arg("-e")
        .arg(
            r#"use Cwd "realpath";
my $d = realpath($ENV{TMPDIR}) or die "realpath: $!\n";
my $p = $ENV{VIXL_SANDBOX_MARKER};
die "marker not under tmpdir" unless index($p, $d) == 0;
open my $f, ">", $p or die "write: $!\n";
print $f "ok";
close $f;
print "ok\n";"#,
        )
        .output()
        .expect("sandbox-exec spawn");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let wrote = std::fs::read_to_string(&marker);
    let _ = std::fs::remove_file(&marker);

    assert!(
        output.status.success(),
        "sandbox-exec TMPDIR write failed: status={} stderr={} stdout={}",
        output.status,
        stderr,
        stdout
    );
    assert_eq!(stdout.trim(), "ok");
    assert_eq!(wrote.expect("marker file"), "ok");
}

#[test]
fn profile_omits_project_write_when_read_only() {
    let home = "/Users/aidanhibbard";
    let project_root = "/Users/aidanhibbard/proj";
    let writable = generate_seatbelt_profile(false, home, project_root);
    let read_only = generate_seatbelt_profile_with(false, false, home, project_root);
    let project_write = "(allow file-write* (subpath (param \"PROJECT_ROOT\")))";
    let env_template_allow = "(regex #\"/\\.env\\.(example|sample|template)$\")";

    assert!(
        writable.contains(project_write),
        "writable profile must allow PROJECT_ROOT writes"
    );
    assert!(
        !read_only.contains(project_write),
        "read-only profile must omit PROJECT_ROOT write allow"
    );
    assert!(
        read_only.contains("(allow file-read*  (subpath (param \"PROJECT_ROOT\")))"),
        "read-only profile must still read PROJECT_ROOT"
    );
    assert!(
        read_only.contains("(allow file-write* (subpath (param \"TMPDIR\")))"),
        "read-only profile must keep TMPDIR writable"
    );
    assert!(
        read_only.contains("(allow file-write* (subpath \"/tmp\"))"),
        "read-only profile must keep /tmp writable"
    );
    assert!(
        read_only
            .contains("(allow file-write* (subpath (string-append (param \"HOME\") \"/.cache\")))"),
        "read-only profile must keep home caches writable"
    );
    assert!(
        writable.contains(env_template_allow),
        "writable profile must allow env templates"
    );
    assert!(
        !read_only.contains(env_template_allow),
        "read-only profile must not re-allow env template writes"
    );
}
