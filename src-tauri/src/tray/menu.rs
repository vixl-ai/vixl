use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::{AppHandle, Runtime};

use super::summary::{agent_menu_label, TraySnapshot};

pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    snapshot: &TraySnapshot,
) -> tauri::Result<Menu<R>> {
    let new_chat = MenuItem::with_id(app, "new-chat", "New Chat", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Vixl", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Vixl", true, None::<&str>)?;
    let (header_id, header_text) = if snapshot.agents.is_empty() {
        ("running-empty", "No running agents")
    } else {
        ("running-header", "Running Agents")
    };
    let header = MenuItem::with_id(app, header_id, header_text, false, None::<&str>)?;
    let mut agent_items = Vec::with_capacity(snapshot.agents.len());
    for agent in &snapshot.agents {
        let label = agent_menu_label(&agent.title, agent.progress);
        let id = format!("agent:{}", agent.chat_id);
        agent_items.push(MenuItem::with_id(app, id, label, true, None::<&str>)?);
    }
    let overflow = if snapshot.overflow > 0 {
        let label = format!("+{} more running agents", snapshot.overflow);
        Some(MenuItem::with_id(
            app,
            "running-overflow",
            label,
            false,
            None::<&str>,
        )?)
    } else {
        None
    };

    let mut builder = MenuBuilder::new(app)
        .item(&new_chat)
        .separator()
        .item(&header);
    for item in &agent_items {
        builder = builder.item(item);
    }
    if let Some(item) = &overflow {
        builder = builder.item(item);
    }
    builder.separator().item(&show).item(&quit).build()
}
