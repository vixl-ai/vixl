pub mod commands;
mod tray;

use tauri::Manager;

use commands::http::HttpStreamRegistry;
use commands::{
    append_chat_line, append_temp_log, codegraph_cli, codegraph_store_stat, config_exists,
    create_chat, delete_chat, delete_graph, delete_secret, file_checkpoint_capture,
    file_checkpoint_restore, fork_chat, fs_apply_patch, fs_copy, fs_delete, fs_edit_file,
    fs_list_dir, fs_list_dir_tree, fs_mkdir, fs_move, fs_read_file, fs_rename, fs_stage_preview,
    fs_stat, fs_write_file, get_active_project, get_default_workspace_root, get_secret,
    get_user_vixl_dir, get_vixl_dir, git_branch_create, git_checkout_branch, git_commit, git_diff,
    git_list_branches, git_log, git_repo_info, git_show_file, git_status, has_project_vixl,
    http_proxy_request, http_proxy_stream, http_proxy_stream_cancel, list_chats, list_graphs,
    list_pinned_chats, list_project_files, list_vixl_files, lsp_catalog, lsp_ensure_server,
    lsp_install_server, lsp_prefetch_defaults, lsp_request, lsp_set_server_disabled, lsp_status,
    lsp_stop_server, lsp_uninstall_server, mcp_call_tool, mcp_list_statuses, mcp_list_tools,
    mcp_logout, mcp_refresh, mcp_start, mcp_status, mcp_stop, oauth_begin_loopback,
    oauth_cancel_loopback, open_external_url, open_project_at_path, open_project_at_path_command,
    pin_chat, read_chat_messages, read_chat_meta, read_json_file, read_lsp_config, read_mcp_config,
    read_settings, registry_add_project, registry_list_projects, registry_remove_project,
    registry_set_active_project, registry_update_project_root, resolve_launch_path,
    reveal_in_folder, set_secret, shell_kill_pty, shell_kill_tracked, shell_resize_pty,
    shell_spawn_pty, shell_spawn_tracked, shell_write_pty, truncate_chat_log, update_chat_meta,
    watch_vixl_paths, web_fetch, workspace_glob, workspace_grep, write_json_file, write_lsp_config,
    write_mcp_config, write_settings, write_temp_bytes, write_temp_handoff, write_text_file,
    OAuthLoopbackState, WatchState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_launch_path(None);
}

pub fn run_with_launch_path(launch_path: Option<String>) {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    let builder = builder
        .manage(WatchState::new())
        .manage(HttpStreamRegistry::default())
        .manage(OAuthLoopbackState::new())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(path_arg) = launch_path.as_deref() {
                match resolve_launch_path(path_arg) {
                    Ok(path) => {
                        if let Err(error) = open_project_at_path(&app.handle(), path) {
                            log::error!("Failed to open CLI project: {error}");
                        }
                    }
                    Err(error) => log::error!("Invalid CLI path: {error}"),
                }
            }

            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    hide_macos_traffic_lights(&window);
                }
            }

            tray::setup(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if crate::commands::config::tray_background_enabled(window.app_handle()) {
                    api.prevent_close();
                    tray::handle_close_requested(window);
                }
            }
        });

    let builder = builder.invoke_handler(tauri::generate_handler![
        get_user_vixl_dir,
        get_default_workspace_root,
        has_project_vixl,
        read_settings,
        write_settings,
        read_mcp_config,
        write_mcp_config,
        read_json_file,
        write_json_file,
        config_exists,
        registry_list_projects,
        registry_add_project,
        open_project_at_path_command,
        registry_remove_project,
        registry_set_active_project,
        registry_update_project_root,
        get_active_project,
        get_secret,
        set_secret,
        delete_secret,
        http_proxy_request,
        http_proxy_stream,
        http_proxy_stream_cancel,
        web_fetch,
        reveal_in_folder,
        git_repo_info,
        git_list_branches,
        git_checkout_branch,
        git_branch_create,
        git_commit,
        get_vixl_dir,
        list_project_files,
        list_vixl_files,
        mcp_start,
        mcp_stop,
        mcp_refresh,
        mcp_logout,
        mcp_list_tools,
        mcp_list_statuses,
        mcp_status,
        open_external_url,
        oauth_begin_loopback,
        oauth_cancel_loopback,
        watch_vixl_paths,
        create_chat,
        list_chats,
        read_chat_meta,
        read_chat_messages,
        append_chat_line,
        truncate_chat_log,
        update_chat_meta,
        delete_chat,
        fork_chat,
        pin_chat,
        list_pinned_chats,
        file_checkpoint_capture,
        file_checkpoint_restore,
        mcp_call_tool,
        codegraph_cli,
        codegraph_store_stat,
        list_graphs,
        delete_graph,
        shell_spawn_pty,
        shell_write_pty,
        shell_resize_pty,
        shell_kill_pty,
        shell_spawn_tracked,
        shell_kill_tracked,
        fs_read_file,
        fs_write_file,
        write_temp_handoff,
        write_temp_bytes,
        append_temp_log,
        write_text_file,
        fs_edit_file,
        fs_apply_patch,
        fs_list_dir,
        fs_list_dir_tree,
        fs_stat,
        fs_stage_preview,
        fs_rename,
        fs_delete,
        fs_copy,
        fs_move,
        fs_mkdir,
        workspace_grep,
        workspace_glob,
        git_status,
        git_diff,
        git_show_file,
        git_log,
        lsp_status,
        lsp_request,
        lsp_ensure_server,
        lsp_stop_server,
        lsp_prefetch_defaults,
        lsp_install_server,
        lsp_catalog,
        lsp_uninstall_server,
        lsp_set_server_disabled,
        read_lsp_config,
        write_lsp_config,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn hide_macos_traffic_lights(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    let ns_window: &NSWindow = unsafe { &*(ns_window_ptr as *const NSWindow) };

    for btn in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(btn) {
            button.setHidden(true);
        }
    }
}
