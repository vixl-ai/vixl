mod append;
mod copy_active_plan;
mod create;
mod delete;
mod fork;
mod import;
mod list;
mod meta;
mod move_chat_to_workspace;
mod paths;
mod pin;
mod project_id;
mod read;
mod rewrite_checkpoints;
mod store;
mod truncate;
mod update;
mod usage;

pub use append::append_chat_line;
pub use copy_active_plan::copy_active_plan_to_root;
pub(crate) use copy_active_plan::copy_tree_skip_existing;
pub use create::create_chat;
pub use delete::delete_chat;
pub use fork::fork_chat;
pub use import::import_jsonl_if_needed;
pub use list::list_chats;
pub use move_chat_to_workspace::move_chat_to_workspace;
pub(crate) use paths::chat_dir_for;
pub use pin::{list_pinned_chats, pin_chat};
pub use read::{read_chat_messages, read_chat_meta};
pub use truncate::truncate_chat_log;
pub use update::update_chat_meta;
pub use usage::{read_chat_usage, write_chat_usage};

#[cfg(test)]
mod tests;
