use app_lib::commands::chat::copy_active_plan_to_root;
use std::fs;
use std::path::Path;

fn write_plan(root: &Path, plan_id: &str, file_name: &str, body: &str) {
    let dir = root.join(".vixl").join("plans").join(plan_id);
    fs::create_dir_all(&dir).expect("plan dir");
    fs::write(dir.join(file_name), body).expect("write plan file");
}

#[test]
fn copies_plan_dir_to_new_root() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "source plan\n");
    write_plan(old_root.path(), "ship-it", "notes.md", "sibling\n");

    copy_active_plan_to_root(
        &old_root.path().to_string_lossy(),
        &new_root.path().to_string_lossy(),
        ".vixl/plans/ship-it/PLAN.md",
    )
    .expect("copy");

    let dest = new_root.path().join(".vixl").join("plans").join("ship-it");
    assert_eq!(
        fs::read_to_string(dest.join("PLAN.md")).expect("read plan"),
        "source plan\n"
    );
    assert_eq!(
        fs::read_to_string(dest.join("notes.md")).expect("read notes"),
        "sibling\n"
    );
}

#[test]
fn missing_source_plan_is_noop_success() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");

    copy_active_plan_to_root(
        &old_root.path().to_string_lossy(),
        &new_root.path().to_string_lossy(),
        ".vixl/plans/missing/PLAN.md",
    )
    .expect("missing source is ok");

    assert!(!new_root.path().join(".vixl").join("plans").exists());
}

#[test]
fn existing_destination_file_is_not_overwritten() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "source\n");
    write_plan(old_root.path(), "ship-it", "notes.md", "new sibling\n");
    write_plan(new_root.path(), "ship-it", "PLAN.md", "keep me\n");

    copy_active_plan_to_root(
        &old_root.path().to_string_lossy(),
        &new_root.path().to_string_lossy(),
        ".vixl/plans/ship-it/PLAN.md",
    )
    .expect("copy");

    let dest = new_root.path().join(".vixl").join("plans").join("ship-it");
    assert_eq!(
        fs::read_to_string(dest.join("PLAN.md")).expect("read plan"),
        "keep me\n"
    );
    assert_eq!(
        fs::read_to_string(dest.join("notes.md")).expect("read notes"),
        "new sibling\n"
    );
}
