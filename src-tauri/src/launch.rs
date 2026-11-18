use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{open_project_at_path, resolve_launch_path};

pub fn parse_launch_path_arg(args: impl IntoIterator<Item = String>) -> Option<String> {
    let mut iter = args.into_iter();
    iter.next();
    iter.find(|arg| arg != "--" && !arg.starts_with('-'))
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            log::error!("Failed to show window: {error}");
        }
        if let Err(error) = window.unminimize() {
            log::error!("Failed to unminimize window: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::error!("Failed to focus window: {error}");
        }
    }
}

#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
fn opened_urls_to_dirs(urls: Vec<tauri::Url>) -> Vec<PathBuf> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| resolve_launch_path(&path.to_string_lossy()).ok())
        .collect()
}

pub fn handle_second_instance(app: &AppHandle, args: Vec<String>) {
    focus_main_window(app);

    // Registry writes and worktree detection stay off the main thread.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path_arg) = parse_launch_path_arg(args) {
            match resolve_launch_path(&path_arg) {
                Ok(path) => {
                    if let Err(error) = open_project_at_path(&app, path) {
                        log::error!("Failed to open CLI project: {error}");
                    }
                }
                Err(error) => log::error!("Invalid CLI path: {error}"),
            }
        }

        if let Err(error) = app.emit("vixl-project-opened", ()) {
            log::error!("Failed to emit project opened event: {error}");
        }
    });
}

#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub fn handle_opened_urls(app: &AppHandle, urls: Vec<tauri::Url>) {
    focus_main_window(app);

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut opened_any = false;
        for path in opened_urls_to_dirs(urls) {
            if let Err(error) = open_project_at_path(&app, path) {
                log::error!("Failed to open CLI project: {error}");
            } else {
                opened_any = true;
            }
        }

        if opened_any {
            if let Err(error) = app.emit("vixl-project-opened", ()) {
                log::error!("Failed to emit project opened event: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{opened_urls_to_dirs, parse_launch_path_arg};

    #[test]
    fn skips_flags() {
        let args = vec![
            "vixl".to_string(),
            "--verbose".to_string(),
            "-h".to_string(),
            "/tmp/proj".to_string(),
        ];
        assert_eq!(parse_launch_path_arg(args).as_deref(), Some("/tmp/proj"));
    }

    #[test]
    fn skips_double_dash() {
        let args = vec![
            "vixl".to_string(),
            "--".to_string(),
            "/tmp/proj".to_string(),
        ];
        assert_eq!(parse_launch_path_arg(args).as_deref(), Some("/tmp/proj"));
    }

    #[test]
    fn first_path_wins() {
        let args = vec![
            "vixl".to_string(),
            "/tmp/first".to_string(),
            "/tmp/second".to_string(),
        ];
        assert_eq!(parse_launch_path_arg(args).as_deref(), Some("/tmp/first"));
    }

    #[test]
    fn empty_args_returns_none() {
        assert_eq!(parse_launch_path_arg(Vec::<String>::new()), None);
        assert_eq!(parse_launch_path_arg(vec!["vixl".to_string()]), None);
        assert_eq!(
            parse_launch_path_arg(vec!["vixl".to_string(), "--help".to_string()]),
            None
        );
    }

    #[test]
    fn opened_file_url_dir_is_kept() {
        let dir = tempfile::tempdir().expect("temp dir");
        let url = tauri::Url::from_file_path(dir.path()).expect("file url");
        let dirs = opened_urls_to_dirs(vec![url]);
        assert_eq!(dirs.len(), 1);
        assert_eq!(
            dirs[0],
            dunce::canonicalize(dir.path()).expect("canonicalize temp dir")
        );
    }

    #[test]
    fn opened_file_url_file_is_dropped() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "x").expect("write temp file");
        let url = tauri::Url::from_file_path(&file).expect("file url");
        assert!(opened_urls_to_dirs(vec![url]).is_empty());
    }

    #[test]
    fn opened_https_url_is_dropped() {
        let url = tauri::Url::parse("https://example.com").expect("https url");
        assert!(opened_urls_to_dirs(vec![url]).is_empty());
    }

    #[test]
    fn accepts_windows_drive_path() {
        let args = vec!["vixl".to_string(), r"C:\Users\me\repo".to_string()];
        assert_eq!(
            parse_launch_path_arg(args).as_deref(),
            Some(r"C:\Users\me\repo")
        );
    }

    #[test]
    fn accepts_path_with_spaces_as_single_arg() {
        let args = vec!["vixl".to_string(), r"C:\Users\me\My Project".to_string()];
        assert_eq!(
            parse_launch_path_arg(args).as_deref(),
            Some(r"C:\Users\me\My Project")
        );
    }
}
