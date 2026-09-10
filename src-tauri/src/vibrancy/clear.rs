pub fn clear_platform_vibrancy(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    clear_macos(window);

    #[cfg(windows)]
    clear_windows(window);

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = window;
    }
}

#[cfg(target_os = "macos")]
fn clear_macos(window: &tauri::WebviewWindow) {
    use tauri::Manager;

    let handle = window.app_handle().clone();
    let window = window.clone();
    if let Err(error) = handle.run_on_main_thread(move || {
        clear_macos_on_main(&window);
    }) {
        log::warn!("Failed to clear window vibrancy on the main thread: {error}");
    }
}

#[cfg(target_os = "macos")]
fn clear_macos_on_main(window: &tauri::WebviewWindow) {
    use objc2_app_kit::NSWindow;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(error) => {
            log::warn!("Failed to get NSWindow to clear vibrancy: {error}");
            return;
        }
    };
    let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };
    let Some(content_view) = ns_window.contentView() else {
        log::warn!("NSWindow has no content view to clear vibrancy");
        return;
    };

    if let Some(effect) = super::macos::find_visual_effect_view(&content_view) {
        effect.removeFromSuperview();
    }
}

#[cfg(windows)]
fn clear_windows(window: &tauri::WebviewWindow) {
    if let Err(error) = window_vibrancy::clear_mica(window) {
        log::warn!("Failed to clear mica: {error}");
    }
    if let Err(error) = window_vibrancy::clear_acrylic(window) {
        log::warn!("Failed to clear acrylic: {error}");
    }
}
