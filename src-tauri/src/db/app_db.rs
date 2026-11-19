use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use super::migrate::migrate;
use super::open::open_at;

/// Cheap to clone so commands can move a handle into blocking tasks instead
/// of borrowing `State` (which cannot cross threads).
#[derive(Clone)]
pub struct AppDb {
    conn: Arc<Mutex<Connection>>,
}

impl AppDb {
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "Database connection lock poisoned".to_string())
    }
}

pub fn open_managed(path: &Path) -> Result<AppDb, String> {
    let conn = open_at(path)?;
    migrate(&conn)?;
    Ok(AppDb {
        conn: Arc::new(Mutex::new(conn)),
    })
}
