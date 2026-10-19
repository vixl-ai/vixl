use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

#[derive(Clone, Copy)]
enum ExistingCopyPolicy {
    SkipExisting,
    ReplaceIfSourceNewer,
}

pub fn copy_active_plan_to_root(
    old_root: &str,
    new_root: &str,
    active_plan_path: &str,
) -> Result<(), String> {
    let relative = active_plan_path.trim();
    if relative.is_empty() {
        return Ok(());
    }

    let relative_path = Path::new(relative);
    if !is_safe_relative(relative_path) {
        return Ok(());
    }

    let source_entry = Path::new(old_root).join(relative_path);
    if !source_entry.exists() {
        return Ok(());
    }

    let source_plan_dir = plan_dir_for_entry(&source_entry, relative_path);
    let dest_plan_dir = Path::new(new_root).join(&source_plan_dir.relative);
    copy_tree(
        &source_plan_dir.absolute,
        &dest_plan_dir,
        ExistingCopyPolicy::ReplaceIfSourceNewer,
    )
}

struct PlanDir {
    absolute: PathBuf,
    relative: PathBuf,
}

fn plan_dir_for_entry(source_entry: &Path, relative_path: &Path) -> PlanDir {
    if source_entry.is_dir() {
        return PlanDir {
            absolute: source_entry.to_path_buf(),
            relative: relative_path.to_path_buf(),
        };
    }

    let absolute = source_entry
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| source_entry.to_path_buf());
    let relative = relative_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| relative_path.to_path_buf());
    PlanDir { absolute, relative }
}

fn is_safe_relative(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    path.components().all(|component| match component {
        Component::Normal(_) | Component::CurDir => true,
        Component::ParentDir | Component::RootDir | Component::Prefix(_) => false,
    })
}

pub fn source_mtime_is_strictly_newer(
    source_mtime: Option<SystemTime>,
    dest_mtime: Option<SystemTime>,
) -> bool {
    match (source_mtime, dest_mtime) {
        (Some(source), Some(dest)) => source > dest,
        _ => false,
    }
}

fn should_replace_existing(from: &Path, to: &Path, policy: ExistingCopyPolicy) -> bool {
    match policy {
        ExistingCopyPolicy::SkipExisting => false,
        ExistingCopyPolicy::ReplaceIfSourceNewer => source_mtime_is_strictly_newer(
            fs::metadata(from)
                .ok()
                .and_then(|meta| meta.modified().ok()),
            fs::metadata(to).ok().and_then(|meta| meta.modified().ok()),
        ),
    }
}

fn copy_tree(from: &Path, to: &Path, policy: ExistingCopyPolicy) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_tree(&entry.path(), &to.join(entry.file_name()), policy)?;
        }
        return Ok(());
    }

    if to.exists() && !should_replace_existing(from, to, policy) {
        return Ok(());
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(from, to).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn copy_tree_skip_existing(from: &Path, to: &Path) -> Result<(), String> {
    copy_tree(from, to, ExistingCopyPolicy::SkipExisting)
}
