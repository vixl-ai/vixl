use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Window,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray.png");

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Vixl", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Vixl", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = load_tray_icon()?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Vixl")
        .build(app)?;

    let app_handle = app.clone();
    app.on_menu_event(move |app, event| match event.id.as_ref() {
        "show" => show_main_window(app),
        "quit" => app.exit(0),
        _ => {}
    });

    app.on_tray_icon_event(move |_tray, event| {
        let should_show = matches!(
            event,
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            }
        );

        if should_show {
            show_main_window(&app_handle);
        }
    });

    Ok(())
}

pub fn handle_close_requested(window: &Window) {
    if let Err(error) = window.hide() {
        log::error!("Failed to hide window to tray: {error}");
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
