use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use uuid::Uuid;

use super::{migrate, migrate_with, open_at, open_managed, SqlMigration};
use crate::commands::paths::{vixl_sqlite_path, VIXL_SQLITE_FILE};

struct TempDbDir {
    path: PathBuf,
}

impl TempDbDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("vixl-db-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp db dir");
        Self { path }
    }

    fn sqlite_path(&self) -> PathBuf {
        self.path.join(VIXL_SQLITE_FILE)
    }
}

impl Drop for TempDbDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn pragma_string(conn: &Connection, name: &str) -> String {
    conn.pragma_query_value(None, name, |row| row.get(0))
        .unwrap_or_else(|error| panic!("pragma {name}: {error}"))
}

fn pragma_i64(conn: &Connection, name: &str) -> i64 {
    conn.pragma_query_value(None, name, |row| row.get(0))
        .unwrap_or_else(|error| panic!("pragma {name}: {error}"))
}

fn migration_versions(conn: &Connection) -> Vec<i64> {
    let mut stmt = conn
        .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
        .expect("prepare versions");
    stmt.query_map([], |row| row.get(0))
        .expect("query versions")
        .map(|row| row.expect("version row"))
        .collect()
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |row| row.get(0),
        )
        .expect("sqlite_master");
    count > 0
}

#[test]
fn vixl_sqlite_path_is_under_user_vixl_dir() {
    let dir = Path::new("/tmp/app-data/.vixl");
    assert_eq!(vixl_sqlite_path(dir), dir.join("vixl.sqlite"));
}

#[test]
fn open_at_creates_file_and_sets_pragmas() {
    let dir = TempDbDir::new();
    let path = dir.sqlite_path();
    let conn = open_at(&path).expect("open_at");

    assert!(path.is_file());
    assert_eq!(pragma_string(&conn, "journal_mode").to_lowercase(), "wal");
    assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
    assert_eq!(pragma_i64(&conn, "busy_timeout"), 5000);
}

#[test]
fn migrate_creates_chat_schema() {
    let dir = TempDbDir::new();
    let conn = open_at(&dir.sqlite_path()).expect("open_at");
    migrate(&conn).expect("migrate");

    assert!(table_exists(&conn, "schema_migrations"));
    assert!(table_exists(&conn, "chats"));
    assert!(table_exists(&conn, "chat_messages"));
    assert!(table_exists(&conn, "chat_usage_rows"));
    assert!(table_exists(&conn, "workbench_tabs"));
    assert!(table_exists(&conn, "editor_view_state"));
    assert!(table_exists(&conn, "workbench_prefs"));
    assert_eq!(migration_versions(&conn), vec![1, 2, 3]);
}

#[test]
fn migrate_with_applies_numbered_sql_once() {
    let dir = TempDbDir::new();
    let path = dir.sqlite_path();
    let migrations = [
        SqlMigration {
            version: 1,
            name: "notes",
            sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY NOT NULL);",
        },
        SqlMigration {
            version: 2,
            name: "note_body",
            sql: "ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT '';",
        },
    ];

    {
        let conn = open_at(&path).expect("open_at");
        migrate_with(&conn, &migrations).expect("first migrate");
        assert_eq!(migration_versions(&conn), vec![1, 2]);
        assert!(table_exists(&conn, "notes"));
    }

    {
        let conn = open_at(&path).expect("reopen");
        migrate_with(&conn, &migrations).expect("second migrate");
        assert_eq!(migration_versions(&conn), vec![1, 2]);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 2);
    }
}

#[test]
fn migrate_with_rejects_non_increasing_versions() {
    let dir = TempDbDir::new();
    let conn = open_at(&dir.sqlite_path()).expect("open_at");
    let err = migrate_with(
        &conn,
        &[
            SqlMigration {
                version: 1,
                name: "a",
                sql: "SELECT 1;",
            },
            SqlMigration {
                version: 1,
                name: "b",
                sql: "SELECT 1;",
            },
        ],
    )
    .expect_err("duplicate versions");
    assert!(err.contains("strictly increasing"));
}

#[test]
fn open_managed_opens_migrates_and_locks() {
    let dir = TempDbDir::new();
    let db = open_managed(&dir.sqlite_path()).expect("open_managed");
    let conn = db.lock().expect("lock");
    assert!(table_exists(&conn, "schema_migrations"));
    assert_eq!(pragma_string(&conn, "journal_mode").to_lowercase(), "wal");
}
