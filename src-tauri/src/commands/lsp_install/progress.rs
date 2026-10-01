use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspInstallProgress {
    pub server_id: String,
    pub state: String,
    pub message: Option<String>,
}

pub(crate) struct InstallMonitor {
    app: AppHandle,
    generation: u64,
    preserve_live: bool,
    began: AtomicBool,
}

impl InstallMonitor {
    pub(crate) fn new(app: AppHandle, generation: u64, preserve_live: bool) -> Self {
        Self {
            app,
            generation,
            preserve_live,
            began: AtomicBool::new(false),
        }
    }

    pub(crate) fn began(&self) -> bool {
        self.began.load(Ordering::SeqCst)
    }

    pub(crate) async fn begin(&self, server_id: &str, message: impl Into<String>) {
        self.began.store(true, Ordering::SeqCst);
        crate::commands::lsp::mark_server_installing(
            &self.app,
            server_id,
            self.generation,
            message.into(),
            self.preserve_live,
        )
        .await;
    }
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
