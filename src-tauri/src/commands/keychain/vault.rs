use std::collections::HashMap;

const KEY_PREFIX: &str = "vixl:";
pub const VAULT_ACCOUNT: &str = "vixl:vault";
pub const SSH_PASSWORD_PREFIX: &str = "vixl:ssh-password:";
pub const SSH_PASSPHRASE_PREFIX: &str = "vixl:ssh-passphrase:";

pub fn deny_ssh_vault_from_webview(key: &str) -> Result<(), String> {
    if key.starts_with(SSH_PASSWORD_PREFIX) || key.starts_with(SSH_PASSPHRASE_PREFIX) {
        return Err(
            "SSH secrets cannot be read or written through the generic secret commands".to_string(),
        );
    }
    Ok(())
}

pub fn webview_secret_command_prepare(key: &str) -> Result<(), String> {
    deny_ssh_vault_from_webview(key)?;
    require_vixl_key(key)?;
    Ok(())
}

pub type VaultMap = HashMap<String, String>;

pub struct LoadedVault {
    pub map: VaultMap,
    pub allow_legacy_probe: bool,
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

pub fn vault_from_file_read(payload: Option<&str>) -> Result<LoadedVault, String> {
    match payload {
        Some(payload) => Ok(LoadedVault {
            map: parse_vault(payload)?,
            allow_legacy_probe: false,
        }),
        None => Ok(LoadedVault {
            map: VaultMap::new(),
            allow_legacy_probe: false,
        }),
    }
}
