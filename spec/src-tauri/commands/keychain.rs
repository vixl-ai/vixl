use app_lib::commands::keychain::{
    choose_secret_backend, deny_ssh_vault_from_webview, merge_legacy_into_map, parse_vault,
    read_vault_file, require_vixl_key, serialize_vault, vault_file_path, vault_from_file_read,
    vault_from_os_read, webview_secret_command_prepare, write_vault_file, KeyringAccessFailure,
    SecretBackendKind, VaultMap, SSH_PASSPHRASE_PREFIX, SSH_PASSWORD_PREFIX, VAULT_ACCOUNT,
};

#[test]
fn parse_vault_empty_payload() {
    let map = parse_vault("").expect("empty vault");
    assert!(map.is_empty());
    let map = parse_vault("   ").expect("whitespace vault");
    assert!(map.is_empty());
}

#[test]
fn parse_vault_round_trip() {
    let mut expected = VaultMap::new();
    expected.insert("vixl:provider:openai".to_string(), "sk-test".to_string());
    expected.insert(
        "vixl:mcp:github:input:token".to_string(),
        "ghp_test".to_string(),
    );
    let payload = serialize_vault(&expected).expect("serialize");
    let parsed = parse_vault(&payload).expect("parse");
    assert_eq!(parsed, expected);
}

#[test]
fn parse_vault_rejects_vault_account_key() {
    let payload = format!(r#"{{"{VAULT_ACCOUNT}":"nope"}}"#);
    let err = parse_vault(&payload).expect_err("vault account key");
    assert!(err.contains("must not contain the vault account key"));
}

#[test]
fn parse_vault_rejects_invalid_json() {
    let err = parse_vault("{not-json").expect_err("invalid json");
    assert!(err.contains("Invalid keychain vault JSON"));
}

#[test]
fn require_vixl_key_rejects_prefix_and_vault_account() {
    assert!(require_vixl_key("other:key").is_err());
    assert!(require_vixl_key(VAULT_ACCOUNT).is_err());
    assert!(require_vixl_key("vixl:provider:openai").is_ok());
}

#[test]
fn get_secret_set_secret_delete_secret_reject_ssh_prefixes() {
    let password = format!("{SSH_PASSWORD_PREFIX}aidanhibbard@eva.local:22");
    let passphrase = format!("{SSH_PASSPHRASE_PREFIX}/tmp/id_ed25519");
    for key in [password.as_str(), passphrase.as_str()] {
        let deny = deny_ssh_vault_from_webview(key).expect_err("ssh vault key");
        assert!(deny
            .contains("SSH secrets cannot be read or written through the generic secret commands"));
        let prepare = webview_secret_command_prepare(key).expect_err("prepare");
        assert!(prepare.contains("SSH secrets cannot"));
    }
    assert!(webview_secret_command_prepare("vixl:provider:openai").is_ok());
}

#[test]
fn merge_legacy_prefers_existing_vault_value() {
    let mut map = VaultMap::new();
    map.insert(
        "vixl:provider:openai".to_string(),
        "vault-value".to_string(),
    );
    let merged = merge_legacy_into_map(
        &mut map,
        "vixl:provider:openai",
        Some("legacy-value".to_string()),
    );
    assert_eq!(merged.as_deref(), Some("vault-value"));
    assert_eq!(
        map.get("vixl:provider:openai").map(String::as_str),
        Some("vault-value")
    );
}

#[test]
fn merge_legacy_inserts_when_missing() {
    let mut map = VaultMap::new();
    let merged = merge_legacy_into_map(
        &mut map,
        "vixl:provider:anthropic",
        Some("sk-legacy".to_string()),
    );
    assert_eq!(merged.as_deref(), Some("sk-legacy"));
    assert_eq!(
        map.get("vixl:provider:anthropic").map(String::as_str),
        Some("sk-legacy")
    );
}

#[test]
fn merge_legacy_returns_none_when_absent() {
    let mut map = VaultMap::new();
    let merged = merge_legacy_into_map(&mut map, "vixl:provider:missing", None);
    assert!(merged.is_none());
    assert!(map.is_empty());
}

#[test]
fn vault_from_os_read_exists_disables_legacy_probe() {
    let loaded = vault_from_os_read(Some("{}")).expect("empty json vault");
    assert!(loaded.map.is_empty());
    assert!(!loaded.allow_legacy_probe);

    let loaded = vault_from_os_read(Some("")).expect("empty string vault");
    assert!(loaded.map.is_empty());
    assert!(!loaded.allow_legacy_probe);

    let payload = r#"{"vixl:provider:openai":"sk-test"}"#;
    let loaded = vault_from_os_read(Some(payload)).expect("populated vault");
    assert_eq!(
        loaded.map.get("vixl:provider:openai").map(String::as_str),
        Some("sk-test")
    );
    assert!(!loaded.allow_legacy_probe);
}

#[test]
fn vault_from_os_read_absent_allows_legacy_probe() {
    let loaded = vault_from_os_read(None).expect("absent vault");
    assert!(loaded.map.is_empty());
    assert!(loaded.allow_legacy_probe);
}

#[test]
fn vault_from_file_read_never_allows_legacy_probe() {
    let loaded = vault_from_file_read(None).expect("missing file");
    assert!(loaded.map.is_empty());
    assert!(!loaded.allow_legacy_probe);

    let loaded = vault_from_file_read(Some("")).expect("empty file");
    assert!(loaded.map.is_empty());
    assert!(!loaded.allow_legacy_probe);

    let payload = r#"{"vixl:provider:openai":"sk-file"}"#;
    let loaded = vault_from_file_read(Some(payload)).expect("populated file");
    assert_eq!(
        loaded.map.get("vixl:provider:openai").map(String::as_str),
        Some("sk-file")
    );
    assert!(!loaded.allow_legacy_probe);
}

#[test]
fn choose_secret_backend_linux_falls_back_on_access_failure() {
    assert_eq!(
        choose_secret_backend(true, None),
        SecretBackendKind::OsKeychain
    );
    assert_eq!(
        choose_secret_backend(true, Some(KeyringAccessFailure::PlatformFailure)),
        SecretBackendKind::ConfigFile
    );
    assert_eq!(
        choose_secret_backend(true, Some(KeyringAccessFailure::NoStorageAccess)),
        SecretBackendKind::ConfigFile
    );
}

#[test]
fn choose_secret_backend_non_linux_never_falls_back() {
    assert_eq!(
        choose_secret_backend(false, None),
        SecretBackendKind::OsKeychain
    );
    assert_eq!(
        choose_secret_backend(false, Some(KeyringAccessFailure::PlatformFailure)),
        SecretBackendKind::OsKeychain
    );
    assert_eq!(
        choose_secret_backend(false, Some(KeyringAccessFailure::NoStorageAccess)),
        SecretBackendKind::OsKeychain
    );
}

#[test]
fn file_backend_round_trip_in_temp_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = vault_file_path(dir.path());
    let mut expected = VaultMap::new();
    expected.insert("vixl:provider:openai".to_string(), "sk-file".to_string());

    write_vault_file(&path, &expected).expect("write");
    let loaded = read_vault_file(&path).expect("read");
    assert_eq!(loaded.map, expected);
    assert!(!loaded.allow_legacy_probe);
}

#[test]
fn file_backend_missing_file_is_empty_without_legacy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = vault_file_path(dir.path());
    let loaded = read_vault_file(&path).expect("missing file");
    assert!(loaded.map.is_empty());
    assert!(!loaded.allow_legacy_probe);
}

#[cfg(unix)]
#[test]
fn file_backend_sets_unix_600_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("tempdir");
    let path = vault_file_path(dir.path());
    let mut map = VaultMap::new();
    map.insert("vixl:provider:openai".to_string(), "sk-perm".to_string());
    write_vault_file(&path, &map).expect("write");
    let mode = std::fs::metadata(&path)
        .expect("metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600);
}
