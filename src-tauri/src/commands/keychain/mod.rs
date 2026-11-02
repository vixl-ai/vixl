mod backend;
mod file;
mod os;
mod vault;

use lazy_static::lazy_static;
use std::sync::Mutex;
use tauri::AppHandle;

use file::vault_file_path_for_app;
use os::{
    delete_legacy_secret, detect_backend, read_legacy_secret, read_vault_from_os, write_vault_to_os,
};

pub use backend::{
    choose_secret_backend, classify_keyring_access_failure, KeyringAccessFailure, SecretBackendKind,
};
pub use file::{read_vault_file, vault_file_path, write_vault_file};
pub use vault::{
    deny_ssh_vault_from_webview, merge_legacy_into_map, parse_vault, require_vixl_key,
    serialize_vault, vault_from_file_read, vault_from_os_read, webview_secret_command_prepare,
    LoadedVault, VaultMap, SSH_PASSPHRASE_PREFIX, SSH_PASSWORD_PREFIX, VAULT_ACCOUNT,
};

struct VaultState {
    loaded: bool,
    allow_legacy_probe: bool,
    map: VaultMap,
    backend: Option<SecretBackendKind>,
}

impl VaultState {
    fn empty() -> Self {
        Self {
            loaded: false,
            allow_legacy_probe: false,
            map: VaultMap::new(),
            backend: None,
        }
    }
}

lazy_static! {
    static ref VAULT: Mutex<VaultState> = Mutex::new(VaultState::empty());
}

fn resolve_backend(state: &mut VaultState) -> Result<SecretBackendKind, String> {
    if let Some(kind) = state.backend {
        return Ok(kind);
    }
    let kind = detect_backend()?;
    state.backend = Some(kind);
    Ok(kind)
}

fn ensure_vault_loaded(app: &AppHandle, state: &mut VaultState) -> Result<(), String> {
    if state.loaded {
        return Ok(());
    }
    let backend = resolve_backend(state)?;
    let loaded = match backend {
        SecretBackendKind::OsKeychain => read_vault_from_os()?,
        SecretBackendKind::ConfigFile => read_vault_file(&vault_file_path_for_app(app)?)?,
    };
    state.map = loaded.map;
    state.allow_legacy_probe = loaded.allow_legacy_probe;
    state.loaded = true;
    Ok(())
}

fn persist_vault(app: &AppHandle, state: &mut VaultState) -> Result<(), String> {
    let backend = resolve_backend(state)?;
    match backend {
        SecretBackendKind::OsKeychain => write_vault_to_os(&state.map)?,
        SecretBackendKind::ConfigFile => {
            write_vault_file(&vault_file_path_for_app(app)?, &state.map)?;
        }
    }
    state.loaded = true;
    Ok(())
}

fn migrate_legacy_into_vault(state: &mut VaultState, key: &str) -> Result<Option<String>, String> {
    let legacy = read_legacy_secret(key)?;
    let before_len = state.map.len();
    let value = merge_legacy_into_map(&mut state.map, key, legacy);
    if value.is_some() && state.map.len() > before_len {
        write_vault_to_os(&state.map)?;
        state.loaded = true;
        let _ = delete_legacy_secret(key);
    }
    Ok(value)
}

pub(crate) fn vault_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    require_vixl_key(key)?;
    let mut state = VAULT
        .lock()
        .map_err(|_| "Keychain vault lock poisoned".to_string())?;
    ensure_vault_loaded(app, &mut state)?;
    if let Some(value) = state.map.get(key) {
        return Ok(Some(value.clone()));
    }
    if !state.allow_legacy_probe {
        return Ok(None);
    }
    migrate_legacy_into_vault(&mut state, key)
}

pub(crate) fn vault_set(app: &AppHandle, key: &str, value: String) -> Result<(), String> {
    require_vixl_key(key)?;
    let mut state = VAULT
        .lock()
        .map_err(|_| "Keychain vault lock poisoned".to_string())?;
    ensure_vault_loaded(app, &mut state)?;
    state.map.insert(key.to_string(), value);
    persist_vault(app, &mut state)?;
    if state.allow_legacy_probe {
        let _ = delete_legacy_secret(key);
    }
    Ok(())
}

pub(crate) fn vault_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    require_vixl_key(key)?;
    let mut state = VAULT
        .lock()
        .map_err(|_| "Keychain vault lock poisoned".to_string())?;
    ensure_vault_loaded(app, &mut state)?;
    state.map.remove(key);
    persist_vault(app, &mut state)?;
    if state.allow_legacy_probe {
        let _ = delete_legacy_secret(key);
    }
    Ok(())
}

pub(crate) fn vault_keys_prefixed(app: &AppHandle, prefix: &str) -> Result<Vec<String>, String> {
    require_vixl_key(prefix)?;
    let mut state = VAULT
        .lock()
        .map_err(|_| "Keychain vault lock poisoned".to_string())?;
    ensure_vault_loaded(app, &mut state)?;
    Ok(state
        .map
        .keys()
        .filter(|key| key.starts_with(prefix))
        .cloned()
        .collect())
}

#[tauri::command]
pub fn get_secret(app: AppHandle, key: String) -> Result<Option<String>, String> {
    webview_secret_command_prepare(&key)?;
    vault_get(&app, &key)
}

#[tauri::command]
pub fn set_secret(app: AppHandle, key: String, value: String) -> Result<(), String> {
    webview_secret_command_prepare(&key)?;
    vault_set(&app, &key, value)
}

#[tauri::command]
pub fn delete_secret(app: AppHandle, key: String) -> Result<(), String> {
    webview_secret_command_prepare(&key)?;
    vault_delete(&app, &key)
}
