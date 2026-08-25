use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use super::migrate::migrate;
use super::open::open_at;

pub struct AppDb {
    conn: Mutex<Connection>,
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
        conn: Mutex::new(conn),
    })
}
