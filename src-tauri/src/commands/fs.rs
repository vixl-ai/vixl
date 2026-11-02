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
pub use edit::{fs_apply_patch, fs_edit_file, fs_stage_preview};
pub(crate) use path::{
    canonical_project_root, relative_path, resolve_command_path, resolve_workspace_path,
    workspace_roots_from_args,
};
pub use path::{is_sensitive_relative_path, WorkspaceRootArg};
pub use read::{fs_list_dir, fs_list_dir_tree, fs_read_file, fs_stat};
pub(crate) use remote::{
    parse_ssh_project_root, resolve_target, uses_ssh_transport, validate_relative, FsTarget,
    SshProjectRoot,
};
pub use types::{
    DiffLine, FileDiff, FileDiffHunk, FsDirEntry, FsEditReplacement, FsReadFileResult,
    FsStagePreviewRequest, FsStatResult, FsTreeNode, WriteTempHandoffResult,
};
pub use write::{
    append_temp_log, fs_copy, fs_delete, fs_mkdir, fs_move, fs_rename, fs_write_file,
    write_temp_bytes, write_temp_handoff, write_text_file,
};
