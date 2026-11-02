use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::askpass::SecretKind;
use super::errors::SshErrorCopy;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatusEvent {
    pub user: String,
    pub hostname: String,
    pub port: u16,
    pub line: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfirmEvent {
    pub request_id: String,
    pub hostname: String,
    pub port: u16,
    pub fingerprint: Option<String>,
    pub key_type: Option<String>,
    pub prompt: String,
    pub address: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSecretEvent {
    pub request_id: String,
    pub hostname: String,
    pub port: u16,
    pub prompt: String,
    pub kind: SecretKind,
    pub saveable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshBannerEvent {
    pub hostname: String,
    pub port: u16,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshErrorEvent {
    pub hostname: String,
    pub port: u16,
    pub title: String,
    pub body: String,
}

pub const EVENT_STATUS: &str = "ssh://status";
pub const EVENT_CONFIRM: &str = "ssh://confirm";
pub const EVENT_SECRET: &str = "ssh://secret";
pub const EVENT_BANNER: &str = "ssh://banner";
pub const EVENT_ERROR: &str = "ssh://error";

pub fn emit_status(app: Option<&AppHandle>, event: &SshStatusEvent) {
    if let Some(app) = app {
        let _ = app.emit(EVENT_STATUS, event);
    }
}

pub fn emit_confirm(app: Option<&AppHandle>, event: &SshConfirmEvent) {
    if let Some(app) = app {
        let _ = app.emit(EVENT_CONFIRM, event);
    }
}

pub fn emit_secret(app: Option<&AppHandle>, event: &SshSecretEvent) {
    if let Some(app) = app {
        let _ = app.emit(EVENT_SECRET, event);
    }
}

pub fn emit_banner(app: Option<&AppHandle>, event: &SshBannerEvent) {
    if let Some(app) = app {
        let _ = app.emit(EVENT_BANNER, event);
    }
}

pub fn emit_error(app: Option<&AppHandle>, hostname: &str, port: u16, copy: &SshErrorCopy) {
    if let Some(app) = app {
        let _ = app.emit(
            EVENT_ERROR,
            SshErrorEvent {
                hostname: hostname.to_string(),
                port,
                title: copy.title.clone(),
                body: copy.body.clone(),
            },
        );
    }
}
