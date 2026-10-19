use std::path::Path;

use crate::commands::chat::copy_tree_skip_existing;
use crate::commands::paths::project_vixl_dir;

pub fn copy_vixl_plans_into(root_path: &str, target: &Path) -> Result<(), String> {
    let source = project_vixl_dir(root_path).join("plans");
    if !source.is_dir() {
        return Ok(());
    }

    let dest = target.join(".vixl").join("plans");
    copy_tree_skip_existing(&source, &dest)
}
