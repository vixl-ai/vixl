use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::super::fs::relative_path;
use super::super::lsp_registry::workspace_warm_plan;
use super::ensure_running::ensure_running_server;
use super::helpers::{is_lsp_method_not_found, uri_to_path, LspDiagnosticsEvent};
use super::rpc::{json_rpc_request, LspDiagnosticProvider, LspProcess, LSP_SERVERS};
use super::state::LspServerState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LspWorkspaceDiagnosticMode {
    Workspace,
    OpenDocuments,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspWorkspaceDiagnosticFile {
    pub uri: String,
    pub path: String,
    pub diagnostics: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspWorkspaceDiagnosticsServer {
    pub id: String,
    pub mode: LspWorkspaceDiagnosticMode,
    pub error: Option<String>,
    pub items: Vec<LspWorkspaceDiagnosticFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_state: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LspWorkspaceDiagnosticsResult {
    pub servers: Vec<LspWorkspaceDiagnosticsServer>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedWorkspaceDocumentReport {
    pub kind: String,
    pub uri: String,
    pub diagnostics: serde_json::Value,
}

pub fn parse_diagnostic_provider(value: &serde_json::Value) -> Option<LspDiagnosticProvider> {
    let provider = value
        .get("capabilities")
        .and_then(|capabilities| capabilities.get("diagnosticProvider"))
        .or_else(|| value.get("diagnosticProvider"))?;
    parse_diagnostic_provider_options(provider)
}

pub fn apply_diagnostic_registrations(
    current: &mut Option<LspDiagnosticProvider>,
    params: &serde_json::Value,
) {
    let Some(registrations) = params
        .get("registrations")
        .and_then(|value| value.as_array())
    else {
        return;
    };

    for registration in registrations {
        let method = registration
            .get("method")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if method != "textDocument/diagnostic" && method != "workspace/diagnostic" {
            continue;
        }

        let options = registration
            .get("registerOptions")
            .unwrap_or(&serde_json::Value::Null);
        let parsed =
            parse_diagnostic_provider_options(options).unwrap_or_else(|| LspDiagnosticProvider {
                workspace_diagnostics: method == "workspace/diagnostic",
                identifier: None,
            });
        merge_diagnostic_provider(current, parsed);
    }
}

pub fn parse_workspace_diagnostic_report(
    report: &serde_json::Value,
) -> Vec<ParsedWorkspaceDocumentReport> {
    let Some(items) = report.get("items").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let kind = item.get("kind").and_then(|value| value.as_str())?;
            if kind != "full" && kind != "unchanged" {
                return None;
            }
            let uri = item.get("uri").and_then(|value| value.as_str())?;
            let diagnostics = if kind == "full" {
                item.get("items")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            } else {
                serde_json::json!([])
            };
            Some(ParsedWorkspaceDocumentReport {
                kind: kind.to_string(),
                uri: uri.to_string(),
                diagnostics,
            })
        })
        .collect()
}

fn parse_diagnostic_provider_options(value: &serde_json::Value) -> Option<LspDiagnosticProvider> {
    if value.as_bool() == Some(false) || value.is_null() {
        return None;
    }
    if value.as_bool() == Some(true) {
        return Some(LspDiagnosticProvider {
            workspace_diagnostics: false,
            identifier: None,
        });
    }
    let object = value.as_object()?;
    let workspace_diagnostics = object
        .get("workspaceDiagnostics")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let identifier = object
        .get("identifier")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(LspDiagnosticProvider {
        workspace_diagnostics,
        identifier,
    })
}

fn merge_diagnostic_provider(
    current: &mut Option<LspDiagnosticProvider>,
    incoming: LspDiagnosticProvider,
) {
    match current {
        None => *current = Some(incoming),
        Some(existing) => {
            existing.workspace_diagnostics =
                existing.workspace_diagnostics || incoming.workspace_diagnostics;
            if incoming.identifier.is_some() {
                existing.identifier = incoming.identifier;
            }
        }
    }
}

fn workspace_relative_from_uri(workspace_root: &str, uri: &str) -> String {
    relative_path(Path::new(workspace_root), &uri_to_path(uri))
}

fn files_from_uri_map(
    diagnostics_by_uri: &HashMap<String, serde_json::Value>,
    workspace_root: &str,
) -> Vec<LspWorkspaceDiagnosticFile> {
    let mut items: Vec<_> = diagnostics_by_uri
        .iter()
        .map(|(uri, diagnostics)| LspWorkspaceDiagnosticFile {
            uri: uri.clone(),
            path: workspace_relative_from_uri(workspace_root, uri),
            diagnostics: diagnostics.clone(),
        })
        .collect();
    items.sort_by(|left, right| left.path.cmp(&right.path).then(left.uri.cmp(&right.uri)));
    items
}

fn unavailable_from_status(status: LspServerState) -> LspWorkspaceDiagnosticsServer {
    LspWorkspaceDiagnosticsServer {
        id: status.id,
        mode: LspWorkspaceDiagnosticMode::Unavailable,
        error: status.error,
        items: vec![],
        install_state: Some(status.phase.as_str().to_string()),
    }
}

async fn items_from_cache(
    process: &Mutex<LspProcess>,
    workspace_root: &str,
) -> Vec<LspWorkspaceDiagnosticFile> {
    let diagnostics_by_uri = {
        let guard = process.lock().await;
        guard.diagnostics_by_uri.clone()
    };
    files_from_uri_map(&diagnostics_by_uri, workspace_root)
}

async fn merge_full_reports(
    app: &AppHandle,
    server_id: &str,
    process: &Mutex<LspProcess>,
    parsed: &[ParsedWorkspaceDocumentReport],
) {
    for item in parsed {
        if item.kind != "full" {
            continue;
        }
        {
            let mut guard = process.lock().await;
            guard
                .diagnostics_by_uri
                .insert(item.uri.clone(), item.diagnostics.clone());
        }
        let _ = app.emit(
            "lsp://diagnostics",
            LspDiagnosticsEvent {
                uri: item.uri.clone(),
                diagnostics: item.diagnostics.clone(),
                server_id: server_id.to_string(),
            },
        );
    }
}

async fn files_from_workspace_report(
    process: &Mutex<LspProcess>,
    workspace_root: &str,
    parsed: &[ParsedWorkspaceDocumentReport],
) -> Vec<LspWorkspaceDiagnosticFile> {
    let cache = {
        let guard = process.lock().await;
        guard.diagnostics_by_uri.clone()
    };
    let mut items: Vec<_> = parsed
        .iter()
        .map(|item| {
            let diagnostics = if item.kind == "full" {
                item.diagnostics.clone()
            } else {
                cache
                    .get(&item.uri)
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([]))
            };
            LspWorkspaceDiagnosticFile {
                uri: item.uri.clone(),
                path: workspace_relative_from_uri(workspace_root, &item.uri),
                diagnostics,
            }
        })
        .collect();
    items.sort_by(|left, right| left.path.cmp(&right.path).then(left.uri.cmp(&right.uri)));
    items
}

async fn pull_workspace_diagnostics(
    app: &AppHandle,
    server_id: &str,
    process: Arc<Mutex<LspProcess>>,
    workspace_root: &str,
) -> LspWorkspaceDiagnosticsServer {
    let (supports_workspace, identifier) = {
        let guard = process.lock().await;
        match &guard.diagnostic_provider {
            Some(provider) => (provider.workspace_diagnostics, provider.identifier.clone()),
            None => (false, None),
        }
    };

    if !supports_workspace {
        return LspWorkspaceDiagnosticsServer {
            id: server_id.to_string(),
            mode: LspWorkspaceDiagnosticMode::OpenDocuments,
            error: None,
            items: items_from_cache(&process, workspace_root).await,
            install_state: None,
        };
    }

    let mut params = serde_json::json!({ "previousResultIds": [] });
    if let Some(identifier) = identifier {
        if let Some(object) = params.as_object_mut() {
            object.insert(
                "identifier".to_string(),
                serde_json::Value::String(identifier),
            );
        }
    }

    match json_rpc_request(&process, "workspace/diagnostic", params).await {
        Ok(result) => {
            let parsed = parse_workspace_diagnostic_report(&result);
            merge_full_reports(app, server_id, &process, &parsed).await;
            LspWorkspaceDiagnosticsServer {
                id: server_id.to_string(),
                mode: LspWorkspaceDiagnosticMode::Workspace,
                error: None,
                items: files_from_workspace_report(&process, workspace_root, &parsed).await,
                install_state: None,
            }
        }
        Err(error) if is_lsp_method_not_found(&error) => LspWorkspaceDiagnosticsServer {
            id: server_id.to_string(),
            mode: LspWorkspaceDiagnosticMode::OpenDocuments,
            error: None,
            items: items_from_cache(&process, workspace_root).await,
            install_state: None,
        },
        Err(error) => LspWorkspaceDiagnosticsServer {
            id: server_id.to_string(),
            mode: LspWorkspaceDiagnosticMode::Unavailable,
            error: Some(error),
            items: items_from_cache(&process, workspace_root).await,
            install_state: None,
        },
    }
}

async fn report_for_status(
    app: &AppHandle,
    status: LspServerState,
    workspace_root: &str,
) -> LspWorkspaceDiagnosticsServer {
    if !status.running {
        return unavailable_from_status(status);
    }

    let managed = {
        let servers = LSP_SERVERS.lock().await;
        servers.get(&status.id).cloned()
    };
    let Some(managed) = managed else {
        return unavailable_from_status(status);
    };

    pull_workspace_diagnostics(app, &status.id, managed.process.clone(), workspace_root).await
}

#[tauri::command]
pub async fn lsp_workspace_diagnostics(
    app: AppHandle,
    project_root: String,
) -> Result<LspWorkspaceDiagnosticsResult, String> {
    let root = PathBuf::from(&project_root);
    let plan = tokio::task::spawn_blocking(move || workspace_warm_plan(&root))
        .await
        .map_err(|error| format!("Workspace warm plan failed: {error}"))?;
    let mut seen = HashSet::new();
    let mut servers = Vec::new();

    for (planned_id, extension) in plan.server_ids.iter().zip(plan.extensions.iter()) {
        if !seen.insert(planned_id.clone()) {
            continue;
        }

        let report = match ensure_running_server(&app, extension, Some(project_root.clone())).await
        {
            Ok(status) => {
                seen.insert(status.id.clone());
                report_for_status(&app, status, &project_root).await
            }
            Err(error) => LspWorkspaceDiagnosticsServer {
                id: planned_id.clone(),
                mode: LspWorkspaceDiagnosticMode::Unavailable,
                error: Some(error),
                items: vec![],
                install_state: None,
            },
        };
        servers.push(report);
    }

    Ok(LspWorkspaceDiagnosticsResult { servers })
}
