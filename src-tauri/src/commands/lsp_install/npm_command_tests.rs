use super::*;
use std::fs;

fn unique_dir(label: &str) -> PathBuf {
    env::temp_dir().join(format!("vixl-npm-{label}-{}", uuid::Uuid::new_v4()))
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("temp parent");
    }
    fs::write(path, contents).expect("write file");
}

#[cfg(unix)]
#[test]
fn unix_portable_npm_symlink_resolves_to_cli_js() {
    let root = unique_dir("unix-portable");
    let bin = root.join("bin");
    let cli = root
        .join("lib")
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    let node = bin.join("node");
    let npm = bin.join("npm");
    write_file(&node, "node");
    write_file(&cli, "#!/usr/bin/env node\n");
    std::os::unix::fs::symlink(&cli, &npm).expect("npm symlink");

    let entry = resolve_unix_npm_entry(&node, Some(&npm)).expect("entry");
    assert_eq!(
        entry,
        NpmEntry::NodeScript(cli.canonicalize().expect("cli"))
    );

    let via_sibling = resolve_unix_npm_entry(&node, None).expect("sibling");
    assert_eq!(
        via_sibling,
        NpmEntry::NodeScript(cli.canonicalize().expect("cli"))
    );

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn unix_regular_npm_file_is_passed_to_node() {
    let root = unique_dir("unix-file");
    let bin = root.join("bin");
    let node = bin.join("node");
    let npm = bin.join("npm");
    write_file(&node, "node");
    write_file(&npm, "#!/usr/bin/env node\n");

    let entry = resolve_unix_npm_entry(&node, Some(&npm)).expect("entry");
    let NpmEntry::NodeScript(path) = entry else {
        panic!("expected node script");
    };
    assert_eq!(path, npm.canonicalize().expect("npm"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn windows_layout_prefers_npm_cli_js() {
    let root = unique_dir("win-cli");
    let node = root.join("node.exe");
    let cli = root
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    let npm_cmd = root.join("npm.cmd");
    write_file(&node, "node");
    write_file(&cli, "module.exports = {}\n");
    write_file(&npm_cmd, "@ECHO OFF\n");

    let entry = resolve_windows_npm_entry(&node, Some(&npm_cmd)).expect("entry");
    assert_eq!(entry, NpmEntry::NodeScript(cli));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn windows_layout_falls_back_to_npm_cmd() {
    let root = unique_dir("win-cmd");
    let node = root.join("node.exe");
    let npm_cmd = root.join("npm.cmd");
    write_file(&node, "node");
    write_file(&npm_cmd, "@ECHO OFF\n");

    let entry = resolve_windows_npm_entry(&node, Some(&npm_cmd)).expect("entry");
    assert_eq!(entry, NpmEntry::WindowsCmd(npm_cmd));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn missing_npm_returns_none() {
    let root = unique_dir("missing");
    let node = root.join("bin").join("node");
    write_file(&node, "node");

    assert_eq!(resolve_unix_npm_entry(&node, None), None);
    assert_eq!(resolve_windows_npm_entry(&node, None), None);
    assert_eq!(resolve_unix_npm_entry(&node, Some(&root.join("npm"))), None);

    let _ = fs::remove_dir_all(root);
}
