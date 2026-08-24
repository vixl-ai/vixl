use keyring::Entry;
use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE: &str = "vixl";
const KEY_PREFIX: &str = "vixl:";
pub const VAULT_ACCOUNT: &str = "vixl:vault";

pub type VaultMap = HashMap<String, String>;

/// Result of loading the vault account from the OS keychain.
pub struct LoadedVault {
  pub map: VaultMap,
  /// When true, missing keys may be read from per-key legacy keychain entries once.
  /// False when the vault account already exists (including empty JSON).
  pub allow_legacy_probe: bool,
}

struct VaultState {
  loaded: bool,
  allow_legacy_probe: bool,
  map: VaultMap,
}

impl VaultState {
  fn empty() -> Self {
    Self {
      loaded: false,
      allow_legacy_probe: false,
      map: VaultMap::new(),
    }
  }
}

lazy_static! {
  static ref VAULT: Mutex<VaultState> = Mutex::new(VaultState::empty());
}

pub fn require_vixl_key(key: &str) -> Result<(), String> {
  if !key.starts_with(KEY_PREFIX) {
    return Err("Keychain key must start with 'vixl:'".to_string());
  }
  if key == VAULT_ACCOUNT {
    return Err("Keychain key cannot be the vault account".to_string());
  }
  Ok(())
}

fn map_keyring_error(err: keyring::Error) -> String {
  match err {
    keyring::Error::NoEntry => "No entry".to_string(),
    keyring::Error::PlatformFailure(inner) => {
      format!(
        "OS keychain unavailable ({inner}). On Linux, ensure a Secret Service provider (for example gnome-keyring) is running."
      )
    }
    keyring::Error::NoStorageAccess(inner) => {
      format!(
        "OS keychain access denied ({inner}). Unlock your system keyring or grant vixl access."
      )
    }
    other => other.to_string(),
  }
}

fn vault_entry() -> Result<Entry, String> {
  Entry::new(SERVICE, VAULT_ACCOUNT).map_err(map_keyring_error)
}

fn legacy_entry(key: &str) -> Result<Entry, String> {
  Entry::new(SERVICE, key).map_err(map_keyring_error)
}

pub fn parse_vault(payload: &str) -> Result<VaultMap, String> {
  if payload.trim().is_empty() {
    return Ok(VaultMap::new());
  }
  let map: VaultMap = serde_json::from_str(payload)
    .map_err(|err| format!("Invalid keychain vault JSON ({err})"))?;
  if map.contains_key(VAULT_ACCOUNT) {
    return Err("Keychain vault must not contain the vault account key".to_string());
  }
  Ok(map)
}

pub fn serialize_vault(map: &VaultMap) -> Result<String, String> {
  serde_json::to_string(map).map_err(|err| format!("Failed to serialize keychain vault ({err})"))
}

/// Insert a legacy keychain value into the vault map if the key is not already present.
/// Returns the value that should be used for the key (existing vault value, or migrated).
pub fn merge_legacy_into_map(
  map: &mut VaultMap,
  key: &str,
  legacy_value: Option<String>,
) -> Option<String> {
  if let Some(existing) = map.get(key) {
    return Some(existing.clone());
  }
  let value = legacy_value?;
  map.insert(key.to_string(), value.clone());
  Some(value)
}

/// Build a loaded vault from an OS read: `Some(payload)` when the vault account exists
/// (including empty JSON), `None` when the account is missing (first-time vault).
pub fn vault_from_os_read(payload: Option<&str>) -> Result<LoadedVault, String> {
  match payload {
    Some(payload) => Ok(LoadedVault {
      map: parse_vault(payload)?,
      allow_legacy_probe: false,
    }),
    None => Ok(LoadedVault {
      map: VaultMap::new(),
      allow_legacy_probe: true,
    }),
  }
}

fn read_vault_from_os() -> Result<LoadedVault, String> {
  match vault_entry()?.get_password() {
    Ok(payload) => vault_from_os_read(Some(&payload)),
    Err(keyring::Error::NoEntry) => vault_from_os_read(None),
    Err(err) => Err(map_keyring_error(err)),
  }
}

fn write_vault_to_os(map: &VaultMap) -> Result<(), String> {
  let payload = serialize_vault(map)?;
  vault_entry()?
    .set_password(&payload)
    .map_err(map_keyring_error)
}

fn read_legacy_secret(key: &str) -> Result<Option<String>, String> {
  match legacy_entry(key)?.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(err) => Err(map_keyring_error(err)),
  }
}

fn delete_legacy_secret(key: &str) -> Result<(), String> {
  match legacy_entry(key)?.delete_credential() {
    Ok(()) => Ok(()),
    Err(keyring::Error::NoEntry) => Ok(()),
    Err(err) => Err(map_keyring_error(err)),
  }
}

fn ensure_vault_loaded(state: &mut VaultState) -> Result<(), String> {
  if state.loaded {
    return Ok(());
  }
  let loaded = read_vault_from_os()?;
  state.map = loaded.map;
  state.allow_legacy_probe = loaded.allow_legacy_probe;
  state.loaded = true;
  Ok(())
}

fn persist_vault(state: &mut VaultState) -> Result<(), String> {
  write_vault_to_os(&state.map)?;
  state.loaded = true;
  Ok(())
}

fn migrate_legacy_into_vault(state: &mut VaultState, key: &str) -> Result<Option<String>, String> {
  let legacy = read_legacy_secret(key)?;
  let before_len = state.map.len();
  let value = merge_legacy_into_map(&mut state.map, key, legacy);
  if value.is_some() && state.map.len() > before_len {
    persist_vault(state)?;
    let _ = delete_legacy_secret(key);
  }
  Ok(value)
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
  require_vixl_key(&key)?;
  let mut state = VAULT
    .lock()
    .map_err(|_| "Keychain vault lock poisoned".to_string())?;
  ensure_vault_loaded(&mut state)?;
  if let Some(value) = state.map.get(&key) {
    return Ok(Some(value.clone()));
  }
  if !state.allow_legacy_probe {
    return Ok(None);
  }
  migrate_legacy_into_vault(&mut state, &key)
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
  require_vixl_key(&key)?;
  let mut state = VAULT
    .lock()
    .map_err(|_| "Keychain vault lock poisoned".to_string())?;
  ensure_vault_loaded(&mut state)?;
  state.map.insert(key.clone(), value);
  persist_vault(&mut state)?;
  if state.allow_legacy_probe {
    let _ = delete_legacy_secret(&key);
  }
  Ok(())
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
  require_vixl_key(&key)?;
  let mut state = VAULT
    .lock()
    .map_err(|_| "Keychain vault lock poisoned".to_string())?;
  ensure_vault_loaded(&mut state)?;
  state.map.remove(&key);
  persist_vault(&mut state)?;
  if state.allow_legacy_probe {
    let _ = delete_legacy_secret(&key);
  }
  Ok(())
}
