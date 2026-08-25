use std::fs;
use std::path::PathBuf;

use serde_json::json;
use uuid::Uuid;

use super::store;
use super::types::WorkbenchTabInput;
use crate::db::{migrate, open_at};

struct TempDbDir {
    path: PathBuf,
}

impl TempDbDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("vixl-workbench-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp db dir");
        Self { path }
    }
}

impl Drop for TempDbDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn open_migrated() -> (TempDbDir, rusqlite::Connection) {
    let dir = TempDbDir::new();
    let conn = open_at(&dir.path.join("vixl.sqlite")).expect("open_at");
    migrate(&conn).expect("migrate");
    (dir, conn)
}

fn editor_tab(id: &str, project_id: &str) -> WorkbenchTabInput {
    WorkbenchTabInput {
        id: id.to_string(),
        project_id: project_id.to_string(),
        tab_type: "editor".to_string(),
        label: "main.ts".to_string(),
        payload: json!({
            "path": "src/main.ts",
            "openPaths": ["src/main.ts"],
            "dirty": true
        }),
    }
}

fn terminal_tab(id: &str, project_id: &str) -> WorkbenchTabInput {
    WorkbenchTabInput {
        id: id.to_string(),
        project_id: project_id.to_string(),
        tab_type: "terminal".to_string(),
        label: "Terminal".to_string(),
        payload: json!({
            "sessionId": "pty-live",
            "cwd": "/tmp/proj"
        }),
    }
}

#[test]
fn replace_and_load_round_trip_tabs() {
    let (_dir, conn) = open_migrated();
    store::replace_session(
        &conn,
        &[editor_tab("t1", "p1"), terminal_tab("t2", "p1")],
        Some("t2"),
        Some(true),
    )
    .expect("replace");

    let session = store::load_session(&conn).expect("load");
    assert_eq!(session.tabs.len(), 2);
    assert_eq!(session.tabs[0].id, "t1");
    assert_eq!(session.tabs[0].project_id, "p1");
    assert_eq!(session.tabs[0].tab_type, "editor");
    assert_eq!(session.tabs[0].payload["path"], "src/main.ts");
    assert!(session.tabs[0].payload.get("dirty").is_none());
    assert_eq!(session.active_tab_id.as_deref(), Some("t2"));
    assert_eq!(session.right_sidebar_open, Some(true));
}

#[test]
fn load_strips_terminal_session_id() {
    let (_dir, conn) = open_migrated();
    store::replace_session(&conn, &[terminal_tab("term", "p1")], Some("term"), None)
        .expect("replace");

    let session = store::load_session(&conn).expect("load");
    assert_eq!(session.tabs.len(), 1);
    assert_eq!(
        session.tabs[0].payload["sessionId"],
        serde_json::Value::Null
    );
    assert_eq!(session.tabs[0].payload["cwd"], "/tmp/proj");
}

#[test]
fn view_state_upsert() {
    let (_dir, conn) = open_migrated();
    let first = json!({ "cursorState": [{ "position": { "lineNumber": 1, "column": 2 } }] });
    store::save_view_state(&conn, "p1", "src/a.ts", &first).expect("save first");
    let loaded = store::load_view_state(&conn, "p1", "src/a.ts")
        .expect("load")
        .expect("present");
    assert_eq!(loaded, first);

    let second = json!({ "cursorState": [{ "position": { "lineNumber": 10, "column": 1 } }] });
    store::save_view_state(&conn, "p1", "src/a.ts", &second).expect("upsert");
    let updated = store::load_view_state(&conn, "p1", "src/a.ts")
        .expect("load again")
        .expect("present");
    assert_eq!(updated, second);
    assert!(store::load_view_state(&conn, "p1", "src/missing.ts")
        .expect("missing")
        .is_none());
}
