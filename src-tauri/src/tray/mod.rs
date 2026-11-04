use std::collections::HashMap;
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::MenuEvent;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Window};

use crate::commands::chat::{
    count_running_chats, list_running_chats, recent_harness_event_json, RunningChatRow,
};
use crate::db::AppDb;

use menu::build_menu;
use summary::{resolve_agent_progress, TrayAgentRow, TraySnapshot, HARNESS_EVENT_SCAN_LIMIT};

mod menu;
#[path = "plan-todos.rs"]
mod plan_todos;
mod summary;

#[cfg(test)]
#[path = "path-tests.rs"]
mod path_tests;
#[cfg(test)]
mod tests;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/tray.png");

pub struct TrayAgentsState {
    agents: Mutex<HashMap<String, TrayAgentTarget>>,
}

#[derive(Clone)]
struct TrayAgentTarget {
    project_slug: String,
    chat_id: String,
}

impl Default for TrayAgentsState {
    fn default() -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
        }
    }
}

impl TrayAgentsState {
    fn replace(&self, snapshot: &TraySnapshot) -> Result<(), String> {
        let mut next = HashMap::new();
        for agent in &snapshot.agents {
            next.insert(
                agent.chat_id.clone(),
                TrayAgentTarget {
                    project_slug: agent.project_slug.clone(),
                    chat_id: agent.chat_id.clone(),
                },
            );
        }
        let mut guard = self
            .agents
            .lock()
            .map_err(|_| "Tray agent state lock poisoned".to_string())?;
        *guard = next;
        Ok(())
    }

    fn target(&self, chat_id: &str) -> Result<Option<TrayAgentTarget>, String> {
        let guard = self
            .agents
            .lock()
            .map_err(|_| "Tray agent state lock poisoned".to_string())?;
        Ok(guard.get(chat_id).cloned())
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayOpenChatPayload {
    project_slug: String,
    chat_id: String,
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayAgentsState::default());
    let menu = build_agents_menu(app).map_err(tray_error)?;
    let icon = load_tray_icon()?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Vixl")
        .build(app)?;

    app.on_menu_event(|app, event| handle_menu_event(app, event));
    Ok(())
}

pub fn refresh_agents(app: &AppHandle) -> Result<(), String> {
    let menu = build_agents_menu(app)?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon is not ready".to_string())?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_refresh_agents(app: AppHandle) -> Result<(), String> {
    refresh_agents(&app)
}

pub fn handle_close_requested(window: &Window) {
    if let Err(error) = window.hide() {
        log::error!("Failed to hide window to tray: {error}");
    }
}

fn build_agents_menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let snapshot = load_snapshot(app)?;
    let menu = build_menu(app, &snapshot).map_err(|error| error.to_string())?;
    let state = app
        .try_state::<TrayAgentsState>()
        .ok_or_else(|| "Tray agent state is not ready".to_string())?;
    state.replace(&snapshot)?;
    Ok(menu)
}

fn load_snapshot(app: &AppHandle) -> Result<TraySnapshot, String> {
    let db = app
        .try_state::<AppDb>()
        .ok_or_else(|| "Database is not ready".to_string())?;
    let (chats, events, total) = {
        let conn = db.lock()?;
        let chats: Vec<RunningChatRow> = list_running_chats(&conn)?;
        let mut events = Vec::with_capacity(chats.len());
        for chat in &chats {
            events.push(recent_harness_event_json(
                &conn,
                &chat.id,
                HARNESS_EVENT_SCAN_LIMIT,
            )?);
        }
        let total = count_running_chats(&conn)?;
        (chats, events, total)
    };

    let mut agents = Vec::with_capacity(chats.len());
    for (chat, chat_events) in chats.into_iter().zip(events) {
        let progress = resolve_agent_progress(
            &chat.project_root,
            chat.active_plan_path.as_deref(),
            &chat_events,
        );
        agents.push(TrayAgentRow {
            chat_id: chat.id,
            project_slug: chat.project_slug,
            title: chat.title,
            progress,
        });
    }
    let shown = agents.len() as i64;
    let overflow = if total > shown {
        (total - shown) as u32
    } else {
        0
    };
    Ok(TraySnapshot { agents, overflow })
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "show" => show_main_window(app),
        "quit" => app.exit(0),
        "new-chat" => {
            show_main_window(app);
            if let Err(error) = app.emit("vixl-tray-new-agent", ()) {
                log::error!("Failed to emit tray new agent: {error}");
            }
        }
        other => {
            let Some(chat_id) = other.strip_prefix("agent:") else {
                return;
            };
            let Some(state) = app.try_state::<TrayAgentsState>() else {
                return;
            };
            let target = match state.target(chat_id) {
                Ok(Some(target)) => target,
                Ok(None) => return,
                Err(error) => {
                    log::error!("Failed to read tray agent state: {error}");
                    return;
                }
            };
            show_main_window(app);
            let payload = TrayOpenChatPayload {
                project_slug: target.project_slug,
                chat_id: target.chat_id,
            };
            if let Err(error) = app.emit("vixl-tray-open-chat", payload) {
                log::error!("Failed to emit tray open chat: {error}");
            }
        }
    }
}

fn load_tray_icon() -> tauri::Result<Image<'static>> {
    Ok(Image::from_bytes(TRAY_ICON_PNG)?.to_owned())
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::warn!("Main window not found when showing from tray");
        return;
    };

    if let Err(error) = window.show() {
        log::error!("Failed to show main window: {error}");
    }
    if let Err(error) = window.unminimize() {
        log::error!("Failed to unminimize main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::error!("Failed to focus main window: {error}");
    }
}

fn tray_error(message: String) -> tauri::Error {
    tauri::Error::Io(std::io::Error::other(message))
}
