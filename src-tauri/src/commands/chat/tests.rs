use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use uuid::Uuid;

use super::meta::ChatMeta;
use super::project_id::{resolve_project_id, HOME_PROJECT_ID};
use super::store;
use crate::commands::registry::{FleetProject, FleetProjectGroup};
use crate::db::{migrate, open_at};

struct TempDbDir {
    path: PathBuf,
}

impl TempDbDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("vixl-chat-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp db dir");
        Self { path }
    }
}

impl Drop for TempDbDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn open_migrated() -> (TempDbDir, Connection) {
    let dir = TempDbDir::new();
    let conn = open_at(&dir.path.join("vixl.sqlite")).expect("open_at");
    migrate(&conn).expect("migrate");
    (dir, conn)
}

fn sample_meta(id: &str, slug: &str, title: &str, updated_at: &str) -> ChatMeta {
    ChatMeta {
        id: id.to_string(),
        title: title.to_string(),
        project_slug: slug.to_string(),
        project_root: "/tmp/proj".to_string(),
        mode: "agent".to_string(),
        model: "test-model".to_string(),
        status: "idle".to_string(),
        attention: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: updated_at.to_string(),
        last_user_message_at: None,
        forked_from: None,
        pinned: false,
        pinned_at: None,
        prefix_snapshot: None,
        active_context: None,
        awaiting_plan_go: None,
        active_plan_path: None,
        subagent_model: None,
        reasoning: None,
        subagent_reasoning: None,
        usage_totals: None,
    }
}

fn user_line(id: &str) -> serde_json::Value {
    message_line(id, "user", "2026-01-01T00:00:00Z")
}

fn message_line(id: &str, role: &str, created_at: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "role": role,
        "parts": [{"type": "text", "text": "hi"}],
        "createdAt": created_at,
        "extraField": "keep-me"
    })
}

#[test]
fn migrate_creates_chat_tables() {
    let (_dir, conn) = open_migrated();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('chats', 'chat_messages', 'chat_usage_rows')",
            [],
            |row| row.get(0),
        )
        .expect("table count");
    assert_eq!(count, 3);
}

#[test]
fn append_bumps_updated_at() {
    let (_dir, conn) = open_migrated();
    let meta = sample_meta("c1", "slug", "Chat", "2020-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    store::insert_message_value(&conn, "c1", 0, &user_line("m1")).expect("insert line");
    store::bump_updated_at(&conn, "slug", "c1").expect("bump");
    let updated = store::get_chat(&conn, "slug", "c1").expect("get");
    assert_ne!(updated.meta.updated_at, "2020-01-01T00:00:00Z");
}

#[test]
fn truncate_keeps_prefix_in_order() {
    let (_dir, conn) = open_migrated();
    let meta = sample_meta("c1", "slug", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    store::insert_message_value(&conn, "c1", 0, &user_line("m1")).expect("m1");
    store::insert_message_value(&conn, "c1", 1, &user_line("m2")).expect("m2");
    store::insert_message_value(&conn, "c1", 2, &user_line("m3")).expect("m3");
    store::delete_from_seq(&conn, "c1", 2).expect("truncate");
    let messages = store::list_messages(&conn, "c1").expect("list");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["id"], "m1");
    assert_eq!(messages[1]["id"], "m2");
}

#[test]
fn message_round_trip_keeps_extra_fields() {
    let (_dir, conn) = open_migrated();
    let meta = sample_meta("c1", "slug", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    store::insert_message_value(&conn, "c1", 0, &user_line("m1")).expect("m1");
    let messages = store::list_messages(&conn, "c1").expect("list");
    assert_eq!(messages[0]["extraField"], "keep-me");
    assert_eq!(messages[0]["role"], "user");
}

#[test]
fn duplicate_message_ids_are_allowed() {
    let (_dir, conn) = open_migrated();
    let meta = sample_meta("c1", "slug", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    store::insert_message_value(&conn, "c1", 0, &user_line("same")).expect("first");
    store::insert_message_value(&conn, "c1", 1, &user_line("same")).expect("second");
    let messages = store::list_messages(&conn, "c1").expect("list");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["id"], "same");
    assert_eq!(messages[1]["id"], "same");
    assert_eq!(messages[0]["createdAt"], "2026-01-01T00:00:00Z");
}

#[test]
fn fork_copies_message_rows() {
    let (_dir, conn) = open_migrated();
    let source = sample_meta("src", "slug", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &source, "pid").expect("insert source");
    store::insert_message_value(&conn, "src", 0, &user_line("m1")).expect("m1");
    let mut dest = sample_meta("dst", "slug", "Chat (fork)", "2026-01-02T00:00:00Z");
    dest.forked_from = Some("src".to_string());
    store::insert_chat(&conn, &dest, "pid").expect("insert dest");
    store::copy_messages(&conn, "src", "dst").expect("copy");
    let copied = store::list_messages(&conn, "dst").expect("list dest");
    assert_eq!(copied.len(), 1);
    assert_eq!(copied[0]["id"], "m1");
    let dest_meta = store::get_chat(&conn, "slug", "dst").expect("get dest");
    assert_eq!(dest_meta.meta.forked_from.as_deref(), Some("src"));
}

#[test]
fn list_and_pin_order() {
    let (_dir, conn) = open_migrated();
    let older = sample_meta("c1", "slug", "Older", "2026-01-01T00:00:00Z");
    let newer = sample_meta("c2", "slug", "Newer", "2026-02-01T00:00:00Z");
    let mut pinned = sample_meta("c3", "slug", "Pinned", "2025-01-01T00:00:00Z");
    pinned.pinned = true;
    pinned.pinned_at = Some("2026-03-01T00:00:00Z".to_string());
    store::insert_chat(&conn, &older, "pid").expect("c1");
    store::insert_chat(&conn, &newer, "pid").expect("c2");
    store::insert_chat(&conn, &pinned, "pid").expect("c3");

    let listed = store::list_chats_for_slug(&conn, "slug").expect("list");
    assert_eq!(
        listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["c3", "c2", "c1"]
    );

    let pins = store::list_pinned_chats(&conn).expect("pinned");
    assert_eq!(pins.len(), 1);
    assert_eq!(pins[0].id, "c3");
}

#[test]
fn list_orders_by_last_user_message_not_updated_at() {
    let (_dir, conn) = open_migrated();
    let older_user = sample_meta("c-old-user", "slug", "Older user", "2026-01-12T00:00:00Z");
    let newer_user = sample_meta("c-new-user", "slug", "Newer user", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &older_user, "pid").expect("c-old-user");
    store::insert_chat(&conn, &newer_user, "pid").expect("c-new-user");
    store::insert_message_value(
        &conn,
        "c-old-user",
        0,
        &message_line("u-old", "user", "2026-01-02T00:00:00Z"),
    )
    .expect("old user");
    store::insert_message_value(
        &conn,
        "c-new-user",
        0,
        &message_line("u-new", "user", "2026-01-10T00:00:00Z"),
    )
    .expect("new user");

    let listed = store::list_chats_for_slug(&conn, "slug").expect("list");
    assert_eq!(
        listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["c-new-user", "c-old-user"]
    );
    assert_eq!(
        listed[0].last_user_message_at.as_deref(),
        Some("2026-01-10T00:00:00Z")
    );
    assert_eq!(
        listed[1].last_user_message_at.as_deref(),
        Some("2026-01-02T00:00:00Z")
    );
    assert!(listed[1].updated_at > listed[0].updated_at);
}

#[test]
fn list_ignores_assistant_updated_at_bump() {
    let (_dir, conn) = open_migrated();
    let with_newer_user = sample_meta("c-user", "slug", "User", "2026-01-03T00:00:00Z");
    let with_assistant = sample_meta("c-asst", "slug", "Assistant", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &with_newer_user, "pid").expect("c-user");
    store::insert_chat(&conn, &with_assistant, "pid").expect("c-asst");
    store::insert_message_value(
        &conn,
        "c-user",
        0,
        &message_line("u-new", "user", "2026-01-08T00:00:00Z"),
    )
    .expect("newer user");
    store::insert_message_value(
        &conn,
        "c-asst",
        0,
        &message_line("u-old", "user", "2026-01-02T00:00:00Z"),
    )
    .expect("older user");
    store::insert_message_value(
        &conn,
        "c-asst",
        1,
        &message_line("a1", "assistant", "2026-01-12T00:00:00Z"),
    )
    .expect("assistant");
    store::bump_updated_at(&conn, "slug", "c-asst").expect("bump");

    let listed = store::list_chats_for_slug(&conn, "slug").expect("list");
    assert_eq!(
        listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["c-user", "c-asst"]
    );
    assert!(listed[1].updated_at > listed[0].updated_at);
}

#[test]
fn list_ignores_background_wake_user_line() {
    let (_dir, conn) = open_migrated();
    let wake_only = sample_meta("c-wake", "slug", "Wake", "2026-01-12T00:00:00Z");
    let real_user = sample_meta("c-real", "slug", "Real", "2026-01-02T00:00:00Z");
    store::insert_chat(&conn, &wake_only, "pid").expect("c-wake");
    store::insert_chat(&conn, &real_user, "pid").expect("c-real");
    store::insert_message_value(
        &conn,
        "c-wake",
        0,
        &message_line(
            "background-wake:c-wake:tool",
            "user",
            "2026-01-12T00:00:00Z",
        ),
    )
    .expect("wake");
    store::insert_message_value(
        &conn,
        "c-real",
        0,
        &message_line("u-real", "user", "2026-01-05T00:00:00Z"),
    )
    .expect("real user");

    let listed = store::list_chats_for_slug(&conn, "slug").expect("list");
    assert_eq!(
        listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["c-real", "c-wake"]
    );
    assert_eq!(
        listed
            .iter()
            .find(|c| c.id == "c-wake")
            .and_then(|c| c.last_user_message_at.as_deref()),
        None
    );
    assert_eq!(
        listed
            .iter()
            .find(|c| c.id == "c-real")
            .and_then(|c| c.last_user_message_at.as_deref()),
        Some("2026-01-05T00:00:00Z")
    );
}

#[test]
fn list_keeps_pinned_first_with_last_user_order() {
    let (_dir, conn) = open_migrated();
    let mut pinned = sample_meta("c-pin", "slug", "Pinned", "2026-01-01T00:00:00Z");
    pinned.pinned = true;
    pinned.pinned_at = Some("2026-01-01T00:00:00Z".to_string());
    let unpinned = sample_meta("c-free", "slug", "Unpinned", "2026-01-02T00:00:00Z");
    store::insert_chat(&conn, &pinned, "pid").expect("c-pin");
    store::insert_chat(&conn, &unpinned, "pid").expect("c-free");
    store::insert_message_value(
        &conn,
        "c-pin",
        0,
        &message_line("u-old", "user", "2026-01-02T00:00:00Z"),
    )
    .expect("pinned user");
    store::insert_message_value(
        &conn,
        "c-free",
        0,
        &message_line("u-new", "user", "2026-01-10T00:00:00Z"),
    )
    .expect("unpinned user");

    let listed = store::list_chats_for_slug(&conn, "slug").expect("list");
    assert_eq!(
        listed.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["c-pin", "c-free"]
    );
}

#[test]
fn delete_chat_cascades_messages_and_usage() {
    let (_dir, conn) = open_migrated();
    let meta = sample_meta("c1", "slug", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    store::insert_message_value(&conn, "c1", 0, &user_line("m1")).expect("m1");
    store::insert_usage_row(
        &conn,
        "c1",
        0,
        &serde_json::json!({"id": "u1", "at": "2026-01-01T00:00:00Z"}),
    )
    .expect("usage");
    store::delete_chat(&conn, "slug", "c1").expect("delete");
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
        .expect("messages");
    let usage: i64 = conn
        .query_row("SELECT COUNT(*) FROM chat_usage_rows", [], |row| row.get(0))
        .expect("usage");
    assert_eq!(messages, 0);
    assert_eq!(usage, 0);
}

#[test]
fn resolve_project_id_home_and_registry() {
    let projects = vec![FleetProject {
        id: "fleet-1".to_string(),
        name: "Demo".to_string(),
        slug: "demo".to_string(),
        root_path: "/tmp/demo".to_string(),
        last_opened: "now".to_string(),
        worktree: None,
    }];
    assert_eq!(
        resolve_project_id(HOME_PROJECT_ID, "/anywhere", &projects, &[]),
        HOME_PROJECT_ID
    );
    assert_eq!(
        resolve_project_id("demo", "/tmp/demo", &projects, &[]),
        "fleet-1"
    );
    let unmatched = resolve_project_id("other", "/tmp/other", &projects, &[]);
    assert!(unmatched.starts_with("unmatched-"));

    let groups = vec![FleetProjectGroup {
        id: "group-1".to_string(),
        name: "api, web".to_string(),
        slug: "api-web".to_string(),
        member_slugs: vec!["api".to_string(), "web".to_string()],
        last_opened: "now".to_string(),
    }];
    assert_eq!(
        resolve_project_id("api-web", "/tmp/demo", &projects, &groups),
        "group:api-web"
    );
}

#[test]
fn update_chat_reparents_project_fields() {
    let (_dir, conn) = open_migrated();
    let mut meta = sample_meta("c1", "home", "Chat", "2026-01-01T00:00:00Z");
    store::insert_chat(&conn, &meta, "_home_").expect("insert");
    meta.project_slug = "game".to_string();
    meta.project_root = "/tmp/game".to_string();
    store::update_chat(&conn, &meta, "fleet-uuid").expect("update");
    let updated = store::get_chat(&conn, "game", "c1").expect("get");
    assert_eq!(updated.project_id, "fleet-uuid");
    assert_eq!(updated.meta.project_slug, "game");
    assert_eq!(updated.meta.project_root, "/tmp/game");
}

#[test]
fn active_plan_path_survives_insert_update_and_read() {
    let (_dir, conn) = open_migrated();
    let mut meta = sample_meta("c1", "slug", "Chat", "2026-01-01T00:00:00Z");
    meta.active_plan_path = Some(".vixl/plans/example/PLAN.md".to_string());
    store::insert_chat(&conn, &meta, "pid").expect("insert");
    let inserted = store::get_chat(&conn, "slug", "c1").expect("get after insert");
    assert_eq!(
        inserted.meta.active_plan_path.as_deref(),
        Some(".vixl/plans/example/PLAN.md")
    );

    meta.active_plan_path = Some(".vixl/plans/updated/PLAN.md".to_string());
    store::update_chat(&conn, &meta, "pid").expect("update");
    let updated = store::get_chat(&conn, "slug", "c1").expect("get after update");
    assert_eq!(
        updated.meta.active_plan_path.as_deref(),
        Some(".vixl/plans/updated/PLAN.md")
    );

    meta.active_plan_path = None;
    store::update_chat(&conn, &meta, "pid").expect("clear");
    let cleared = store::get_chat(&conn, "slug", "c1").expect("get after clear");
    assert_eq!(cleared.meta.active_plan_path, None);
}
