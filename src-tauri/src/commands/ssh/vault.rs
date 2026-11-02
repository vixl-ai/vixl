use serde::Serialize;
use tauri::AppHandle;

use crate::commands::keychain::{
    vault_delete, vault_get, vault_keys_prefixed, vault_set, SSH_PASSPHRASE_PREFIX,
    SSH_PASSWORD_PREFIX,
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshSavedIdentity {
    pub kind: String,
    pub identity: String,
}

pub fn password_vault_key(user: &str, hostname: &str, port: u16) -> String {
    format!("{SSH_PASSWORD_PREFIX}{user}@{hostname}:{port}")
}

pub fn passphrase_vault_key(key_path: &str) -> String {
    format!("{SSH_PASSPHRASE_PREFIX}{key_path}")
}

pub fn save_password(
    app: &AppHandle,
    user: &str,
    hostname: &str,
    port: u16,
    value: String,
) -> Result<(), String> {
    vault_set(app, &password_vault_key(user, hostname, port), value)
}

pub fn delete_password(
    app: &AppHandle,
    user: &str,
    hostname: &str,
    port: u16,
) -> Result<(), String> {
    vault_delete(app, &password_vault_key(user, hostname, port))
}

pub fn save_passphrase(app: &AppHandle, key_path: &str, value: String) -> Result<(), String> {
    vault_set(app, &passphrase_vault_key(key_path), value)
}

pub fn delete_passphrase(app: &AppHandle, key_path: &str) -> Result<(), String> {
    vault_delete(app, &passphrase_vault_key(key_path))
}

pub fn read_password(
    app: &AppHandle,
    user: &str,
    hostname: &str,
    port: u16,
) -> Result<Option<String>, String> {
    vault_get(app, &password_vault_key(user, hostname, port))
}

pub fn read_passphrase(app: &AppHandle, key_path: &str) -> Result<Option<String>, String> {
    vault_get(app, &passphrase_vault_key(key_path))
}

pub fn list_saved_identities(app: &AppHandle) -> Result<Vec<SshSavedIdentity>, String> {
    let mut out = Vec::new();
    for key in vault_keys_prefixed(app, SSH_PASSWORD_PREFIX)? {
        if let Some(identity) = key.strip_prefix(SSH_PASSWORD_PREFIX) {
            out.push(SshSavedIdentity {
                kind: "password".to_string(),
                identity: identity.to_string(),
            });
        }
    }
    for key in vault_keys_prefixed(app, SSH_PASSPHRASE_PREFIX)? {
        if let Some(identity) = key.strip_prefix(SSH_PASSPHRASE_PREFIX) {
            out.push(SshSavedIdentity {
                kind: "passphrase".to_string(),
                identity: identity.to_string(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn ssh_save_password(
    app: AppHandle,
    user: String,
    hostname: String,
    port: u16,
    value: String,
) -> Result<(), String> {
    save_password(&app, &user, &hostname, port, value)
}

#[tauri::command]
pub fn ssh_delete_password(
    app: AppHandle,
    user: String,
    hostname: String,
    port: u16,
) -> Result<(), String> {
    delete_password(&app, &user, &hostname, port)
}

#[tauri::command]
pub fn ssh_save_passphrase(app: AppHandle, key_path: String, value: String) -> Result<(), String> {
    save_passphrase(&app, &key_path, value)
}

#[tauri::command]
pub fn ssh_delete_passphrase(app: AppHandle, key_path: String) -> Result<(), String> {
    delete_passphrase(&app, &key_path)
}

#[tauri::command]
pub fn ssh_list_saved_identities(app: AppHandle) -> Result<Vec<SshSavedIdentity>, String> {
    list_saved_identities(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::keychain::{
        deny_ssh_vault_from_webview, webview_secret_command_prepare, SSH_PASSPHRASE_PREFIX,
        SSH_PASSWORD_PREFIX,
    };

    #[test]
    fn get_secret_set_secret_delete_secret_reject_ssh_prefixes() {
        let password = password_vault_key("aidanhibbard", "eva.local", 22);
        let passphrase = passphrase_vault_key("/tmp/id_ed25519");
        assert!(password.starts_with(SSH_PASSWORD_PREFIX));
        assert!(passphrase.starts_with(SSH_PASSPHRASE_PREFIX));
        for key in [password.as_str(), passphrase.as_str()] {
            let deny = deny_ssh_vault_from_webview(key).unwrap_err();
            assert!(deny.contains(
                "SSH secrets cannot be read or written through the generic secret commands"
            ));
            let prepare = webview_secret_command_prepare(key).unwrap_err();
            assert!(prepare.contains("SSH secrets cannot"));
        }
        assert!(webview_secret_command_prepare("vixl:provider:openai").is_ok());
    }
}
