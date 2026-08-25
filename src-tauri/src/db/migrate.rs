use rusqlite::{params, Connection};

use super::migrations::{SqlMigration, MIGRATIONS};

const CREATE_SCHEMA_MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
);
";

pub fn migrate(conn: &Connection) -> Result<(), String> {
    migrate_with(conn, MIGRATIONS)
}

pub fn migrate_with(conn: &Connection, migrations: &[SqlMigration]) -> Result<(), String> {
    validate_migration_versions(migrations)?;
    conn.execute_batch(CREATE_SCHEMA_MIGRATIONS)
        .map_err(|error| format!("Failed to create schema_migrations: {error}"))?;

    let applied = applied_versions(conn)?;
    for migration in migrations {
        if applied.contains(&migration.version) {
            continue;
        }
        apply_migration(conn, migration)?;
    }

    Ok(())
}

fn validate_migration_versions(migrations: &[SqlMigration]) -> Result<(), String> {
    let mut previous: Option<i64> = None;
    for migration in migrations {
        if migration.version < 1 {
            return Err(format!(
                "Migration {} must use a version >= 1",
                migration.name
            ));
        }
        if let Some(prev) = previous {
            if migration.version <= prev {
                return Err(format!(
                    "Migration versions must be strictly increasing ({} then {})",
                    prev, migration.version
                ));
            }
        }
        previous = Some(migration.version);
    }
    Ok(())
}

fn applied_versions(conn: &Connection) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
        .map_err(|error| format!("Failed to read schema_migrations: {error}"))?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|error| format!("Failed to query schema_migrations: {error}"))?;

    let mut versions = Vec::new();
    for row in rows {
        versions.push(row.map_err(|error| format!("Failed to read migration version: {error}"))?);
    }
    Ok(versions)
}

fn apply_migration(conn: &Connection, migration: &SqlMigration) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start migration transaction: {error}"))?;
    tx.execute_batch(migration.sql).map_err(|error| {
        format!(
            "Failed to apply migration {} ({}): {error}",
            migration.version, migration.name
        )
    })?;
    tx.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
        params![migration.version],
    )
    .map_err(|error| {
        format!(
            "Failed to record migration {} ({}): {error}",
            migration.version, migration.name
        )
    })?;
    tx.commit()
        .map_err(|error| format!("Failed to commit migration {}: {error}", migration.version))?;
    Ok(())
}
