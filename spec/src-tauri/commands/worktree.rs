use app_lib::commands::git_binary::git_binary;
use app_lib::commands::registry::{
    apply_project_root_update, clear_worktree_links_to_parent, sync_project_worktree_link,
    FleetProject, WorktreeLink,
};
use app_lib::commands::worktree::{
    detect_worktree_parent_among, git_worktree_add_in_dir, git_worktree_list, git_worktree_remove,
    parent_slug_among, parse_worktree_porcelain, validate_worktree_name, GitWorktreeEntry,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn git_bin() -> PathBuf {
    git_binary().expect("git")
}

fn git_output(repo: &Path, args: &[&str]) -> std::process::Output {
    Command::new(git_bin())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .expect("run git")
}

fn git(repo: &Path, args: &[&str]) {
    let output = git_output(repo, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("repo");
    let init = Command::new(git_bin())
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .current_dir(dir.path())
        .args(["init", "-b", "main"])
        .output()
        .expect("git init");
    if !init.status.success() {
        let fallback = Command::new(git_bin())
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .current_dir(dir.path())
            .args(["init"])
            .status()
            .expect("git init fallback");
        assert!(fallback.success(), "git init failed");
    }
    git(dir.path(), &["config", "user.email", "vixl@example.com"]);
    git(dir.path(), &["config", "user.name", "Vixl Tests"]);
    fs::write(dir.path().join("README.md"), "init\n").expect("write readme");
    git(dir.path(), &["add", "README.md"]);
    git(dir.path(), &["commit", "-m", "init"]);
    dir
}

fn path_str(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn sample_project(id: &str, slug: &str, root: &Path) -> FleetProject {
    FleetProject {
        id: id.to_string(),
        name: slug.to_string(),
        slug: slug.to_string(),
        root_path: dunce::canonicalize(root)
            .unwrap_or_else(|_| root.to_path_buf())
            .to_string_lossy()
            .to_string(),
        last_opened: "1".to_string(),
        worktree: None,
    }
}

#[test]
fn parse_porcelain_normal_detached_and_bare() {
    let output = "\
worktree /repos/app
HEAD abcdef
branch refs/heads/main

worktree /repos/app-feature
HEAD 123456
detached

worktree /repos/app.git
bare
";
    let entries = parse_worktree_porcelain(output);
    assert_eq!(
        entries,
        vec![
            GitWorktreeEntry {
                path: "/repos/app".to_string(),
                branch: Some("main".to_string()),
                bare: false,
                detached: false,
            },
            GitWorktreeEntry {
                path: "/repos/app-feature".to_string(),
                branch: None,
                bare: false,
                detached: true,
            },
            GitWorktreeEntry {
                path: "/repos/app.git".to_string(),
                branch: None,
                bare: true,
                detached: false,
            },
        ]
    );
}

#[test]
fn validate_worktree_name_accepts_lowercase_slugs() {
    assert_eq!(validate_worktree_name("a").unwrap(), "a");
    assert_eq!(validate_worktree_name("foo").unwrap(), "foo");
    assert_eq!(validate_worktree_name("foo-bar-2").unwrap(), "foo-bar-2");
    assert_eq!(
        validate_worktree_name(&"a".repeat(64)).unwrap(),
        "a".repeat(64)
    );
}

#[test]
fn validate_worktree_name_rejects_invalid() {
    assert!(validate_worktree_name("").is_err());
    assert!(validate_worktree_name("   ").is_err());
    assert!(validate_worktree_name("Foo").is_err());
    assert!(validate_worktree_name("foo_bar").is_err());
    assert!(validate_worktree_name("foo/bar").is_err());
    assert!(validate_worktree_name("foo\\bar").is_err());
    assert!(validate_worktree_name(".").is_err());
    assert!(validate_worktree_name("..").is_err());
    assert!(validate_worktree_name("...").is_err());
    assert!(validate_worktree_name(&"a".repeat(65)).is_err());
}

#[test]
fn detect_parent_links_registered_worktree() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "feature", None, vixl.path(), "demo")
            .expect("add worktree");

    let parent = sample_project("parent-1", "demo", repo.path());
    let projects = vec![parent];
    let detected = detect_worktree_parent_among(&added.path, &projects)
        .expect("detect")
        .expect("parent match");
    assert_eq!(detected.parent_project_id, "parent-1");
    assert_eq!(detected.branch, "vixl/feature");
}

#[test]
fn detect_parent_returns_null_for_unrelated_repo() {
    let parent_repo = init_repo();
    let other = init_repo();
    let parent = sample_project("parent-1", "demo", parent_repo.path());
    let detected =
        detect_worktree_parent_among(&path_str(other.path()), &[parent]).expect("detect");
    assert_eq!(detected, None);
}

#[test]
fn detect_parent_returns_null_for_non_git_path() {
    let dir = tempfile::tempdir().expect("non-git");
    let parent = sample_project("parent-1", "demo", dir.path());
    let detected = detect_worktree_parent_among(&path_str(dir.path()), &[parent]).expect("detect");
    assert_eq!(detected, None);
}

#[test]
fn add_copies_parent_vixl_plans_into_checkout() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let plan_dir = repo.path().join(".vixl").join("plans").join("ship-it");
    fs::create_dir_all(&plan_dir).expect("plan dir");
    fs::write(plan_dir.join("PLAN.md"), "uncommitted plan\n").expect("write plan");
    fs::write(plan_dir.join("notes.md"), "sibling\n").expect("write notes");

    let added = git_worktree_add_in_dir(&path_str(repo.path()), "plans", None, vixl.path(), "demo")
        .expect("add worktree");

    let dest = Path::new(&added.path)
        .join(".vixl")
        .join("plans")
        .join("ship-it");
    assert_eq!(
        fs::read_to_string(dest.join("PLAN.md")).expect("copied plan"),
        "uncommitted plan\n"
    );
    assert_eq!(
        fs::read_to_string(dest.join("notes.md")).expect("copied notes"),
        "sibling\n"
    );
}

#[test]
fn add_creates_vixl_branch_and_dir_under_user_vixl() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "review", None, vixl.path(), "demo")
            .expect("add worktree");

    assert_eq!(added.branch, "vixl/review");
    assert_eq!(added.name, "review");
    let expected = dunce::canonicalize(vixl.path().join("worktrees").join("demo").join("review"))
        .expect("canonical worktree");
    assert_eq!(PathBuf::from(&added.path), expected);
    assert!(expected.join("README.md").exists());
    git(
        repo.path(),
        &["show-ref", "--verify", "refs/heads/vixl/review"],
    );

    let listed = git_worktree_list(path_str(repo.path())).expect("list");
    assert!(listed.iter().any(|entry| entry.path == added.path
        && entry.branch.as_deref() == Some("vixl/review")
        && !entry.detached
        && !entry.bare));
}

#[test]
fn add_errors_when_branch_already_exists() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    git_worktree_add_in_dir(&path_str(repo.path()), "review", None, vixl.path(), "demo")
        .expect("first add");
    let error =
        git_worktree_add_in_dir(&path_str(repo.path()), "review", None, vixl.path(), "other")
            .expect_err("duplicate branch");
    assert!(
        error.contains("vixl/review") && error.to_lowercase().contains("already exists"),
        "got: {error}"
    );
}

#[test]
fn remove_refuses_foreign_paths() {
    let repo = init_repo();
    let other = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "review", None, vixl.path(), "demo")
            .expect("add worktree");

    let foreign = git_worktree_remove(path_str(other.path()), added.path.clone(), false)
        .expect_err("foreign repo");
    assert!(foreign.contains("not a worktree"), "got: {foreign}");

    let random = tempfile::tempdir().expect("random dir");
    let missing = git_worktree_remove(path_str(repo.path()), path_str(random.path()), false)
        .expect_err("random path");
    assert!(missing.contains("not a worktree"), "got: {missing}");

    git_worktree_remove(path_str(repo.path()), added.path, false).expect("remove own worktree");
}

#[test]
fn remove_force_flag_cleans_dirty_worktree() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added = git_worktree_add_in_dir(&path_str(repo.path()), "dirty", None, vixl.path(), "demo")
        .expect("add worktree");
    fs::write(Path::new(&added.path).join("scratch.txt"), "dirty\n").expect("dirty file");

    let refused =
        git_worktree_remove(path_str(repo.path()), added.path.clone(), false).expect_err("dirty");
    assert!(
        refused.to_lowercase().contains("modif")
            || refused.to_lowercase().contains("untracked")
            || refused.to_lowercase().contains("dirty"),
        "got: {refused}"
    );
    assert!(Path::new(&added.path).exists());

    git_worktree_remove(path_str(repo.path()), added.path.clone(), true).expect("force remove");
    assert!(!Path::new(&added.path).exists());
}

#[test]
fn registry_sets_child_link_on_add_and_clears_on_parent_removal() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "feature", None, vixl.path(), "demo")
            .expect("add worktree");

    let mut projects = vec![
        sample_project("parent-1", "demo", repo.path()),
        sample_project("child-1", "feature", Path::new(&added.path)),
    ];
    sync_project_worktree_link(&mut projects, "child-1", Some(vixl.path()));
    assert_eq!(
        projects[1].worktree.as_ref(),
        Some(&WorktreeLink {
            parent_id: "parent-1".to_string(),
            branch: "vixl/feature".to_string(),
            managed: true,
        })
    );

    projects.retain(|project| project.id != "parent-1");
    clear_worktree_links_to_parent(&mut projects, "parent-1");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].worktree, None);
}

#[test]
fn registry_root_update_resyncs_worktree_link() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let feature =
        git_worktree_add_in_dir(&path_str(repo.path()), "feature", None, vixl.path(), "demo")
            .expect("feature worktree");
    let review =
        git_worktree_add_in_dir(&path_str(repo.path()), "review", None, vixl.path(), "demo")
            .expect("review worktree");

    let mut projects = vec![
        sample_project("parent-1", "demo", repo.path()),
        sample_project("child-1", "feature", Path::new(&feature.path)),
    ];
    sync_project_worktree_link(&mut projects, "child-1", Some(vixl.path()));
    assert_eq!(
        projects[1].worktree.as_ref(),
        Some(&WorktreeLink {
            parent_id: "parent-1".to_string(),
            branch: "vixl/feature".to_string(),
            managed: true,
        })
    );

    apply_project_root_update(
        &mut projects,
        "child-1",
        review.path.clone(),
        Some(vixl.path()),
    )
    .expect("update to other worktree");
    assert_eq!(projects[1].root_path, review.path);
    assert_eq!(
        projects[1].worktree.as_ref(),
        Some(&WorktreeLink {
            parent_id: "parent-1".to_string(),
            branch: "vixl/review".to_string(),
            managed: true,
        })
    );

    let plain = tempfile::tempdir().expect("non-worktree root");
    apply_project_root_update(
        &mut projects,
        "child-1",
        path_str(plain.path()),
        Some(vixl.path()),
    )
    .expect("update to non-worktree");
    assert_eq!(projects[1].root_path, path_str(plain.path()));
    assert_eq!(projects[1].worktree, None);
}

#[test]
fn sync_marks_managed_from_vixl_worktrees_location() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "feature", None, vixl.path(), "demo")
            .expect("add worktree");

    let mut projects = vec![
        sample_project("parent-1", "demo", repo.path()),
        sample_project("child-1", "feature", Path::new(&added.path)),
    ];
    sync_project_worktree_link(&mut projects, "child-1", Some(vixl.path()));
    assert_eq!(
        projects[1].worktree.as_ref().map(|link| link.managed),
        Some(true)
    );

    let other_vixl = tempfile::tempdir().expect("other vixl");
    sync_project_worktree_link(&mut projects, "child-1", Some(other_vixl.path()));
    assert_eq!(
        projects[1].worktree.as_ref().map(|link| link.managed),
        Some(false)
    );

    projects[1].worktree = Some(WorktreeLink {
        parent_id: "parent-1".to_string(),
        branch: "vixl/feature".to_string(),
        managed: true,
    });
    sync_project_worktree_link(&mut projects, "child-1", None);
    assert_eq!(
        projects[1].worktree.as_ref().map(|link| link.managed),
        Some(true)
    );
}

#[test]
fn worktree_field_is_omitted_from_projects_json_when_absent() {
    let project = sample_project("p1", "demo", Path::new("/tmp/demo"));
    let value = serde_json::to_value(&project).expect("serialize");
    assert!(value.get("worktree").is_none());
    assert!(value.get("root_path").is_some());

    let mut with_link = project.clone();
    with_link.worktree = Some(WorktreeLink {
        parent_id: "parent".to_string(),
        branch: "vixl/feature".to_string(),
        managed: false,
    });
    let linked = serde_json::to_value(&with_link).expect("serialize linked");
    assert_eq!(linked["worktree"]["parent_id"], "parent");
    assert_eq!(linked["worktree"]["branch"], "vixl/feature");
    assert_eq!(linked["worktree"]["managed"], false);
}

#[test]
fn parent_slug_from_child_worktree_uses_main_checkout_slug() {
    let repo = init_repo();
    let vixl = tempfile::tempdir().expect("vixl dir");
    let added =
        git_worktree_add_in_dir(&path_str(repo.path()), "feature", None, vixl.path(), "demo")
            .expect("add worktree");

    let mut child = sample_project("child-1", "feature", Path::new(&added.path));
    child.worktree = Some(WorktreeLink {
        parent_id: "parent-1".to_string(),
        branch: "vixl/feature".to_string(),
        managed: true,
    });
    let projects = vec![sample_project("parent-1", "demo", repo.path()), child];

    assert_eq!(parent_slug_among(&added.path, &projects), "demo");
    assert_eq!(parent_slug_among(&path_str(repo.path()), &projects), "demo");
}

#[test]
fn parent_slug_cycle_falls_back_to_matched_slug() {
    let first_root = tempfile::tempdir().expect("cycle-a");
    let second_root = tempfile::tempdir().expect("cycle-b");
    let mut first = sample_project("a", "alpha", first_root.path());
    let mut second = sample_project("b", "beta", second_root.path());
    first.worktree = Some(WorktreeLink {
        parent_id: "b".to_string(),
        branch: "vixl/alpha".to_string(),
        managed: false,
    });
    second.worktree = Some(WorktreeLink {
        parent_id: "a".to_string(),
        branch: "vixl/beta".to_string(),
        managed: false,
    });
    let projects = vec![first, second];

    assert_eq!(
        parent_slug_among(&path_str(second_root.path()), &projects),
        "beta"
    );
    assert_eq!(
        parent_slug_among(&path_str(first_root.path()), &projects),
        "alpha"
    );
}
