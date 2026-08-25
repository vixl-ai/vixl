use app_lib::commands::git::parse_porcelain_status;

#[test]
fn parse_unstaged_modified_keeps_leading_space_path() {
    let entry = parse_porcelain_status(" M README.md").expect("entry");
    assert_eq!(entry.path, "README.md");
    assert_eq!(entry.staged_status, None);
    assert_eq!(entry.unstaged_status.as_deref(), Some("M"));
    assert!(!entry.is_untracked);
}

#[test]
fn parse_trimmed_leading_space_corrupts_path() {
    // Documents the failure mode if stdout is fully trimmed before parse.
    let entry = parse_porcelain_status("M README.md").expect("entry");
    assert_eq!(entry.path, "EADME.md");
    assert_eq!(entry.staged_status.as_deref(), Some("M"));
}

#[test]
fn parse_staged_and_untracked() {
    let staged = parse_porcelain_status("M  src/main.rs").expect("staged");
    assert_eq!(staged.path, "src/main.rs");
    assert_eq!(staged.staged_status.as_deref(), Some("M"));
    assert_eq!(staged.unstaged_status, None);

    let untracked = parse_porcelain_status("?? new-file.ts").expect("untracked");
    assert_eq!(untracked.path, "new-file.ts");
    assert!(untracked.is_untracked);
}

#[test]
fn parse_rename() {
    let entry = parse_porcelain_status("R  old.ts -> new.ts").expect("rename");
    assert_eq!(entry.path, "new.ts");
    assert_eq!(entry.old_path.as_deref(), Some("old.ts"));
    assert_eq!(entry.staged_status.as_deref(), Some("R"));
}
