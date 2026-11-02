mod diff;
mod edit;
mod path;
mod read;
mod remote;
mod sftp;
mod types;
mod write;

#[cfg(test)]
mod remote_tests;

pub use diff::build_hunks;
pub use edit::{
    fs_apply_patch, fs_apply_patch_command, fs_edit_file, fs_edit_file_command, fs_stage_preview,
    fs_stage_preview_command,
};
pub(crate) use path::{
    canonical_project_root, relative_path, resolve_command_path, resolve_workspace_path,
    workspace_roots_from_args,
};
pub use path::{is_sensitive_relative_path, WorkspaceRootArg};
pub use read::{
    fs_list_dir, fs_list_dir_command, fs_list_dir_tree, fs_list_dir_tree_command, fs_read_file,
    fs_read_file_command, fs_stat, fs_stat_command,
};
pub(crate) use remote::{
    close_pooled_sftp, ensure_dir_await, ensure_ssh_project_directory_await, entry_kind_await,
    list_children_await, list_dir_await, modified_ms_await, parse_ssh_project_root,
    read_bytes_await, read_file_await, resolve_target, stat_await, uses_ssh_transport,
    validate_relative, write_bytes_await, FsTarget, SshProjectRoot,
};
pub use types::{
    DiffLine, FileDiff, FileDiffHunk, FsDirEntry, FsEditReplacement, FsReadFileResult,
    FsStagePreviewRequest, FsStatResult, FsTreeNode, WriteTempHandoffResult,
};
pub use write::{
    append_temp_log, fs_copy, fs_copy_command, fs_delete, fs_delete_command, fs_mkdir,
    fs_mkdir_command, fs_move, fs_move_command, fs_rename, fs_rename_command, fs_write_file,
    fs_write_file_command, write_temp_bytes, write_temp_handoff, write_text_file,
};
