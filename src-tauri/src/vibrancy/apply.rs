const DEFAULT_HUE: f64 = 265.0;
const DEFAULT_INTENSITY: f64 = 0.0;

pub fn apply_platform_vibrancy(
    window: &tauri::WebviewWindow,
    dark: bool,
    hue: Option<f64>,
    intensity: Option<f64>,
) {
    let hue = hue.unwrap_or(DEFAULT_HUE);
    let intensity = intensity.unwrap_or(DEFAULT_INTENSITY);

    #[cfg(target_os = "macos")]
    apply_macos(window, dark, hue, intensity);

    #[cfg(windows)]
    apply_windows(window, dark, hue, intensity);

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (window, dark, hue, intensity);
    }
}

#[cfg(target_os = "macos")]
fn apply_macos(window: &tauri::WebviewWindow, dark: bool, hue: f64, intensity: f64) {
    use tauri::Manager;

    let handle = window.app_handle().clone();
    let window = window.clone();
    if let Err(error) = handle.run_on_main_thread(move || {
        apply_macos_on_main(&window, dark, hue, intensity);
    }) {
        log::warn!("Failed to apply window vibrancy on the main thread: {error}");
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_on_main(window: &tauri::WebviewWindow, dark: bool, hue: f64, intensity: f64) {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSAutoresizingMaskOptions, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    };

    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("Window vibrancy must run on the main thread");
        return;
    };

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(error) => {
            log::warn!("Failed to get NSWindow for vibrancy: {error}");
            return;
        }
    };
    let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };
    let Some(content_view) = ns_window.contentView() else {
        log::warn!("NSWindow has no content view for vibrancy");
        return;
    };

    let effect = match super::macos::find_visual_effect_view(&content_view) {
        Some(existing) => existing,
        None => {
            let effect = NSVisualEffectView::initWithFrame(
                NSVisualEffectView::alloc(mtm),
                content_view.bounds(),
            );
            effect.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            content_view.addSubview_positioned_relativeTo(
                &effect,
                NSWindowOrderingMode::Below,
                None,
            );
            effect
        }
    };

    effect.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
    effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    effect.setState(NSVisualEffectState::FollowsWindowActiveState);

    let appearance_name = if dark {
        unsafe { NSAppearanceNameDarkAqua }
    } else {
        unsafe { NSAppearanceNameAqua }
    };
    match NSAppearance::appearanceNamed(appearance_name) {
        Some(appearance) => effect.setAppearance(Some(&appearance)),
        None => log::warn!("Failed to create NSAppearance for window vibrancy"),
    }

    apply_macos_tint(&effect, dark, hue, intensity, mtm);
}

#[cfg(target_os = "macos")]
fn apply_macos_tint(
    effect: &objc2_app_kit::NSVisualEffectView,
    dark: bool,
    hue: f64,
    intensity: f64,
    mtm: objc2::MainThreadMarker,
) {
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSColor};

    const DARK_SATURATION: f64 = 0.55;
    const DARK_BRIGHTNESS: f64 = 0.65;
    const LIGHT_SATURATION: f64 = 0.45;
    const LIGHT_BRIGHTNESS: f64 = 0.95;

    let intensity = intensity.clamp(0.0, 100.0);
    if intensity <= 0.0 {
        if let Some(tint) = super::macos::find_tint_view(effect) {
            tint.removeFromSuperview();
        }
        return;
    }

    let tint = match super::macos::find_tint_view(effect) {
        Some(existing) => existing,
        None => {
            let tint = super::macos::VixlTintView::with_frame(mtm, effect.bounds());
            tint.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            tint.setWantsLayer(true);
            effect.addSubview(&tint);
            tint
        }
    };

    tint.setWantsLayer(true);
    tint.setFrame(effect.bounds());

    let (saturation, brightness) = if dark {
        (DARK_SATURATION, DARK_BRIGHTNESS)
    } else {
        (LIGHT_SATURATION, LIGHT_BRIGHTNESS)
    };
    let alpha = (intensity / 100.0).clamp(0.0, 1.0);
    let color = NSColor::colorWithHue_saturation_brightness_alpha(
        hue / 360.0,
        saturation,
        brightness,
        alpha,
    );

    match tint.layer() {
        Some(layer) => layer.setBackgroundColor(Some(&color.CGColor())),
        None => log::warn!("Tint view has no layer for vibrancy tint"),
    }
}

#[cfg(windows)]
fn apply_windows(window: &tauri::WebviewWindow, dark: bool, hue: f64, intensity: f64) {
    // window-vibrancy mica/acrylic have no hue or intensity; accept and ignore.
    let _ = (hue, intensity);

    if let Err(error) = window_vibrancy::apply_mica(window, Some(dark)) {
        log::warn!("Failed to apply mica: {error}");
        let tint = if dark {
            (18, 18, 18, 125)
        } else {
            (240, 240, 240, 125)
        };
        if let Err(error) = window_vibrancy::apply_acrylic(window, Some(tint)) {
            log::warn!("Failed to apply acrylic: {error}");
        }
    }
}
