//! App Nap prevention for macOS.

use std::sync::Once;

use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

static INIT: Once = Once::new();

/// Holds a user-initiated activity for the app's lifetime so macOS
/// does not App Nap the process while the window is hidden.
pub fn disable_app_nap() {
    INIT.call_once(|| {
        let process_info = NSProcessInfo::processInfo();
        let reason = NSString::from_str("Keep agent streams running in background");
        let token = process_info.beginActivityWithOptions_reason(
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &reason,
        );
        // Leak intentionally: dropping the token re-enables App Nap.
        std::mem::forget(token);
        log::info!("App Nap disabled via NSProcessInfo activity");
    });
}
