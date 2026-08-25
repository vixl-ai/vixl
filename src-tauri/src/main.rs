// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn parse_launch_path_arg() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| arg != "--" && !arg.starts_with('-'))
}

fn main() {
    app_lib::run_with_launch_path(parse_launch_path_arg());
}
