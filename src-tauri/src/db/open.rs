use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

pub fn open_at(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create database directory: {error}"))?;
        }
    }

    let conn = Connection::open(path)
        .map_err(|error| format!("Failed to open database at {}: {error}", path.display()))?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

pub fn apply_pragmas(conn: &Connection) -> Result<(), String> {
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|error| format!("Failed to set busy_timeout: {error}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Failed to set journal_mode=WAL: {error}"))?;
    // NORMAL is the recommended pairing with WAL: no fsync per commit, and
    // durability still holds across app crashes (only power loss can drop
    // the last transactions). Chat lines are written per harness event, so
    // FULL's per-commit fsync was a visible stall.
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("Failed to set synchronous=NORMAL: {error}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Failed to set foreign_keys=ON: {error}"))?;
    Ok(())
}
