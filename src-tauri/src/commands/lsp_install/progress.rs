use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspInstallProgress {
    pub server_id: String,
    pub state: String,
    pub message: Option<String>,
}

pub(crate) fn emit_progress(
    app: &AppHandle,
    server_id: &str,
    state: &str,
    message: Option<String>,
) {
    let _ = app.emit(
        "lsp://install",
        LspInstallProgress {
            server_id: server_id.to_string(),
            state: state.to_string(),
            message,
        },
    );
}
