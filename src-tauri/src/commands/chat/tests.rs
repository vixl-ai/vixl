use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use uuid::Uuid;

use super::meta::ChatMeta;
use super::project_id::{resolve_project_id, HOME_PROJECT_ID};
use super::store;
use crate::commands::registry::FleetProject;
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
        forked_from: None,
        pinned: false,
        pinned_at: None,
        prefix_snapshot: None,
        active_context: None,
        awaiting_plan_go: None,
        subagent_model: None,
        reasoning: None,
        subagent_reasoning: None,
        usage_totals: None,
    }
}

fn user_line(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "role": "user",
        "parts": [{"type": "text", "text": "hi"}],
        "createdAt": "2026-01-01T00:00:00Z",
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
    }];
    assert_eq!(
        resolve_project_id(HOME_PROJECT_ID, "/anywhere", &projects),
        HOME_PROJECT_ID
    );
    assert_eq!(
        resolve_project_id("demo", "/tmp/demo", &projects),
        "fleet-1"
    );
    let unmatched = resolve_project_id("other", "/tmp/other", &projects);
    assert!(unmatched.starts_with("unmatched-"));
}
