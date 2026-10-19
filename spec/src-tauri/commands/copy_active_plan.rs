use app_lib::commands::chat::{copy_active_plan_to_root, source_mtime_is_strictly_newer};
use std::fs::{self, File};
use std::path::Path;
use std::time::{Duration, SystemTime};

fn write_plan(root: &Path, plan_id: &str, file_name: &str, body: &str) {
    let dir = root.join(".vixl").join("plans").join(plan_id);
    fs::create_dir_all(&dir).expect("plan dir");
    fs::write(dir.join(file_name), body).expect("write plan file");
}

fn plan_path(root: &Path, plan_id: &str, file_name: &str) -> std::path::PathBuf {
    root.join(".vixl")
        .join("plans")
        .join(plan_id)
        .join(file_name)
}

fn set_mtime(path: &Path, time: SystemTime) {
    File::options()
        .write(true)
        .open(path)
        .expect("open for mtime")
        .set_modified(time)
        .expect("set mtime");
}

fn copy_ship_it(old_root: &Path, new_root: &Path) {
    copy_active_plan_to_root(
        &old_root.to_string_lossy(),
        &new_root.to_string_lossy(),
        ".vixl/plans/ship-it/PLAN.md",
    )
    .expect("copy");
}

#[test]
fn copies_plan_dir_to_new_root() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "source plan\n");
    write_plan(old_root.path(), "ship-it", "notes.md", "sibling\n");

    copy_ship_it(old_root.path(), new_root.path());

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
fn destination_older_than_source_is_overwritten() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "source newer\n");
    write_plan(new_root.path(), "ship-it", "PLAN.md", "stale dest\n");

    let older = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
    let newer = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000);
    set_mtime(&plan_path(new_root.path(), "ship-it", "PLAN.md"), older);
    set_mtime(&plan_path(old_root.path(), "ship-it", "PLAN.md"), newer);

    copy_ship_it(old_root.path(), new_root.path());

    assert_eq!(
        fs::read_to_string(plan_path(new_root.path(), "ship-it", "PLAN.md")).expect("read plan"),
        "source newer\n"
    );
}

#[test]
fn destination_newer_than_source_is_kept() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "older source\n");
    write_plan(new_root.path(), "ship-it", "PLAN.md", "keep dest\n");

    let older = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
    let newer = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000);
    set_mtime(&plan_path(old_root.path(), "ship-it", "PLAN.md"), older);
    set_mtime(&plan_path(new_root.path(), "ship-it", "PLAN.md"), newer);

    copy_ship_it(old_root.path(), new_root.path());

    assert_eq!(
        fs::read_to_string(plan_path(new_root.path(), "ship-it", "PLAN.md")).expect("read plan"),
        "keep dest\n"
    );
}

#[test]
fn equal_mtime_keeps_destination() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "source\n");
    write_plan(new_root.path(), "ship-it", "PLAN.md", "keep dest\n");

    let same = SystemTime::UNIX_EPOCH + Duration::from_secs(1_500);
    set_mtime(&plan_path(old_root.path(), "ship-it", "PLAN.md"), same);
    set_mtime(&plan_path(new_root.path(), "ship-it", "PLAN.md"), same);

    copy_ship_it(old_root.path(), new_root.path());

    assert_eq!(
        fs::read_to_string(plan_path(new_root.path(), "ship-it", "PLAN.md")).expect("read plan"),
        "keep dest\n"
    );
}

#[test]
fn unreadable_mtime_keeps_destination() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(3_000);
    assert!(!source_mtime_is_strictly_newer(None, Some(now)));
    assert!(!source_mtime_is_strictly_newer(Some(now), None));
    assert!(!source_mtime_is_strictly_newer(None, None));
    assert!(!source_mtime_is_strictly_newer(Some(now), Some(now)));
    assert!(source_mtime_is_strictly_newer(
        Some(now + Duration::from_secs(1)),
        Some(now)
    ));
}

#[test]
fn nested_siblings_follow_per_file_mtime() {
    let old_root = tempfile::tempdir().expect("old root");
    let new_root = tempfile::tempdir().expect("new root");
    write_plan(old_root.path(), "ship-it", "PLAN.md", "fresh plan\n");
    write_plan(old_root.path(), "ship-it", "notes.md", "stale notes\n");
    write_plan(new_root.path(), "ship-it", "PLAN.md", "old plan\n");
    write_plan(new_root.path(), "ship-it", "notes.md", "keep notes\n");

    let older = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
    let newer = SystemTime::UNIX_EPOCH + Duration::from_secs(2_000);
    set_mtime(&plan_path(new_root.path(), "ship-it", "PLAN.md"), older);
    set_mtime(&plan_path(old_root.path(), "ship-it", "PLAN.md"), newer);
    set_mtime(&plan_path(old_root.path(), "ship-it", "notes.md"), older);
    set_mtime(&plan_path(new_root.path(), "ship-it", "notes.md"), newer);

    copy_ship_it(old_root.path(), new_root.path());

    assert_eq!(
        fs::read_to_string(plan_path(new_root.path(), "ship-it", "PLAN.md")).expect("read plan"),
        "fresh plan\n"
    );
    assert_eq!(
        fs::read_to_string(plan_path(new_root.path(), "ship-it", "notes.md")).expect("read notes"),
        "keep notes\n"
    );
}
