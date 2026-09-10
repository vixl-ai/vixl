#[tauri::command]
pub fn set_window_vibrancy(
    window: tauri::WebviewWindow,
    dark: bool,
    hue: Option<f64>,
    intensity: Option<f64>,
) {
    super::apply_platform_vibrancy(&window, dark, hue, intensity);
}

#[tauri::command]
pub fn clear_window_vibrancy(window: tauri::WebviewWindow) {
    super::clear_platform_vibrancy(&window);
}
