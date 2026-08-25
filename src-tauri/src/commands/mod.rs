pub mod chat;
pub mod codegraph;
pub mod config;
pub mod file_checkpoint;
pub mod fs;
pub mod git;
pub mod glob;
pub mod grep;
pub mod http;
pub mod keychain;
pub mod lsp;
pub mod lsp_install;
pub mod lsp_registry;
pub mod mcp;
pub mod oauth;
pub mod paths;
pub mod registry;
#[cfg(target_os = "macos")]
pub mod sandbox;
pub mod shell;
pub mod watch;
pub mod web_fetch;
pub mod workbench;
pub use chat::{
    append_chat_line, create_chat, delete_chat, fork_chat, list_chats, list_pinned_chats, pin_chat,
    read_chat_messages, read_chat_meta, read_chat_usage, truncate_chat_log, update_chat_meta,
    write_chat_usage,
};
pub use codegraph::{codegraph_cli, codegraph_store_stat, delete_graph, list_graphs};
pub use config::{
    config_exists, read_json_file, read_lsp_config, read_mcp_config, read_settings,
    write_json_file, write_lsp_config, write_mcp_config, write_settings,
};
pub use file_checkpoint::{file_checkpoint_capture, file_checkpoint_restore};
pub use fs::{
    append_temp_log, fs_apply_patch, fs_copy, fs_delete, fs_edit_file, fs_list_dir,
    fs_list_dir_tree, fs_mkdir, fs_move, fs_read_file, fs_rename, fs_stage_preview, fs_stat,
    fs_write_file, write_temp_bytes, write_temp_handoff, write_text_file,
};
pub use git::{
    git_branch_create, git_checkout_branch, git_commit, git_diff, git_list_branches, git_log,
    git_repo_info, git_show_file, git_status,
};
pub use glob::workspace_glob;
pub use grep::workspace_grep;
pub use http::{http_proxy_request, http_proxy_stream, http_proxy_stream_cancel};
pub use keychain::{delete_secret, get_secret, set_secret};
pub use lsp::{
    lsp_catalog, lsp_ensure_server, lsp_request, lsp_set_server_disabled, lsp_status,
    lsp_stop_server, lsp_uninstall_server,
};
pub use lsp_install::{lsp_install_server, lsp_prefetch_defaults};
pub use mcp::{
    mcp_call_tool, mcp_list_statuses, mcp_list_tools, mcp_logout, mcp_refresh, mcp_start,
    mcp_status, mcp_stop,
};
pub use oauth::{
    oauth_begin_loopback, oauth_cancel_loopback, open_external_url, OAuthLoopbackState,
};
pub use paths::{
    get_default_workspace_root, get_user_vixl_dir, get_vixl_dir, has_project_vixl,
    list_project_files, list_vixl_files,
};
pub use registry::{
    get_active_project, open_project_at_path, open_project_at_path_command, registry_add_project,
    registry_list_projects, registry_remove_project, registry_set_active_project,
    registry_update_project_root, resolve_launch_path,
};
pub use shell::{
    reveal_in_folder, shell_kill_pty, shell_kill_tracked, shell_resize_pty, shell_spawn_pty,
    shell_spawn_tracked, shell_write_pty,
};
pub use watch::{watch_vixl_paths, WatchState};
pub use web_fetch::web_fetch;
pub use workbench::{
    editor_load_view_state, editor_save_view_state, workbench_load_session,
    workbench_replace_session,
};
