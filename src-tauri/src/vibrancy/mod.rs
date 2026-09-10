mod apply;
mod clear;
mod commands;
#[cfg(target_os = "macos")]
mod macos;

pub use apply::apply_platform_vibrancy;
pub use clear::clear_platform_vibrancy;
pub use commands::{clear_window_vibrancy, set_window_vibrancy};
