use std::collections::HashMap;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;

use super::super::config::workspace_is_trusted;
use super::super::lsp_install::{
    emit_progress, ensure_portable_node, ensure_server_installed, install_source_label,
    named_lock_for,
};
use super::super::lsp_registry::builtin_spec_by_id;
use super::helpers::LspServerStatus;
use super::resolve::{active_project_root, find_server_for_extension, load_effective_servers};
use super::rpc::{set_state, LSP_SERVERS};
use super::start::start_server;
use super::typescript::vue_in_play_for;

lazy_static::lazy_static! {
  static ref START_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> = Mutex::new(HashMap::new());
}

pub async fn start_lock_for(server_id: &str) -> Arc<Mutex<()>> {
    named_lock_for(&START_LOCKS, server_id).await
}

pub(crate) async fn ensure_running_server(
    app: &AppHandle,
    extension: &str,
    project_root: Option<String>,
) -> Result<LspServerStatus, String> {
    let servers = load_effective_servers(app).await?;

    let workspace_root = project_root
        .or_else(|| active_project_root(app))
        .or_else(|| Some(super::super::paths::get_default_workspace_root()))
        .ok_or_else(|| "No active workspace for LSP".to_string())?;

    let (server_id, entry) =
        find_server_for_extension(app, &servers, extension, Some(workspace_root.as_str()))
            .ok_or_else(|| format!("No LSP server configured for extension: {extension}"))?;

    let start_lock = start_lock_for(&server_id).await;
    let _start_guard = start_lock.lock().await;

    let vue_running = LSP_SERVERS.lock().await.contains_key("vue");
    let classic_typescript = vue_in_play_for(&workspace_root, Some(extension), vue_running);

    if classic_typescript {
        if let Some(managed) = LSP_SERVERS.lock().await.get("typescript").cloned() {
            let uses_classic = {
                let guard = managed.process.lock().await;
                guard.uses_classic_typescript
            };
            if !uses_classic {
                super::stop_server_internal("typescript").await.ok();
            }
        }
    }

    if let Some(spec) = builtin_spec_by_id(&server_id) {
        if spec.requires_trust {
            if !workspace_is_trusted(app, Some(workspace_root.as_str())) {
                return Ok(LspServerStatus {
                    id: server_id,
                    running: false,
                    error: Some("Workspace trust required for this language server".to_string()),
                    source: Some("none".to_string()),
                    install_state: Some("needs_trust".to_string()),
                });
            }
        }
    }

    set_state(
        &server_id,
        false,
        None,
        Some(install_source_label(app, &server_id)),
        Some("starting".to_string()),
    )
    .await;

    let install_id = if server_id == "typescript" && classic_typescript {
        "typescript-classic"
    } else {
        server_id.as_str()
    };
    match ensure_server_installed(app, install_id).await {
        Ok(_) => {}
        Err(error) => {
            set_state(
                &server_id,
                false,
                Some(error.clone()),
                Some(install_source_label(app, &server_id)),
                Some("error".to_string()),
            )
            .await;
            let _ = error;
        }
    }
    if server_id == "vue" {
        let _ = ensure_server_installed(app, "typescript-classic").await;
    }

    if builtin_spec_by_id(install_id)
        .or_else(|| builtin_spec_by_id(&server_id))
        .map(|s| s.npm.is_some())
        .unwrap_or(false)
    {
        let _ = ensure_portable_node(app).await;
    }

    if let Some(managed) = LSP_SERVERS.lock().await.get(&server_id).cloned() {
        let (should_restart, current_root, uses_classic) = {
            let restart = managed.restart.lock().await;
            let guard = managed.process.lock().await;
            (
                *restart,
                guard.workspace_root.clone(),
                guard.uses_classic_typescript,
            )
        };

        let stack_mismatch = server_id == "typescript" && uses_classic != classic_typescript;

        if current_root != workspace_root || stack_mismatch {
            super::stop_server_internal(&server_id).await.ok();
        } else if !should_restart {
            let running = {
                let mut guard = managed.process.lock().await;
                guard.child.try_wait().ok().flatten().is_none()
            };

            if running {
                set_state(
                    &server_id,
                    true,
                    None,
                    Some(install_source_label(app, &server_id)),
                    Some("ready".to_string()),
                )
                .await;
                return Ok(LspServerStatus {
                    id: server_id.clone(),
                    running: true,
                    error: None,
                    source: Some(install_source_label(app, &server_id)),
                    install_state: Some("ready".to_string()),
                });
            }
        } else {
            super::stop_server_internal(&server_id).await.ok();
        }
    }

    match start_server(
        server_id.clone(),
        entry,
        workspace_root,
        app.clone(),
        classic_typescript,
    )
    .await
    {
        Ok(_) => Ok(LspServerStatus {
            id: server_id.clone(),
            running: true,
            error: None,
            source: Some(install_source_label(app, &server_id)),
            install_state: Some("ready".to_string()),
        }),
        Err(error) => {
            set_state(
                &server_id,
                false,
                Some(error.clone()),
                Some(install_source_label(app, &server_id)),
                Some("error".to_string()),
            )
            .await;
            emit_progress(app, &server_id, "error", Some(error.clone()));
            Ok(LspServerStatus {
                id: server_id,
                running: false,
                error: Some(error),
                source: Some("none".to_string()),
                install_state: Some("error".to_string()),
            })
        }
    }
}
