//! Another app's SQLite database, read without any chance of a write: the original is never opened,
//! only a temp copy, and the copy opens read-only and immutable. A database from elsewhere can
//! hold anything, so its size, its rows and the time spent on it are all bounded, and the tables a
//! query names must be real tables, since a view could run whatever its author wrote.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

use super::{ImportError, open_zip, starts_with_zip_magic};

const MAX_DB_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) const MAX_ROWS: i64 = 500_000;
const QUERY_TIME: Duration = Duration::from_secs(120);
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// The temp copy; removed when the import is done with it, whatever happened.
pub struct TempDb {
    dir: PathBuf,
    path: PathBuf,
}

impl Drop for TempDb {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.dir) {
            tracing::debug!(%error, "[import] could not remove a temp database");
        }
    }
}

fn copy_bounded(reader: impl std::io::Read, path: &Path) -> Result<(), ImportError> {
    let mut out = std::fs::File::create(path)?;
    let copied = std::io::copy(&mut reader.take(MAX_DB_BYTES + 1), &mut out)?;
    if copied > MAX_DB_BYTES {
        return Err(ImportError::TooLarge);
    }
    Ok(())
}

/// Copies the database out of a backup zip, or the file itself when it is one.
pub fn copy_to_temp(source: &Path, entry_name: &str) -> Result<TempDb, ImportError> {
    let dir = std::env::temp_dir().join(format!("flow-import-db-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    let temp = TempDb {
        path: dir.join("import.db"),
        dir,
    };
    if starts_with_zip_magic(source)? {
        let mut archive = open_zip(source)?;
        let suffix = format!("/{entry_name}");
        let name = archive
            .file_names()
            .find(|name| *name == entry_name || name.ends_with(&suffix))
            .map(str::to_string)
            .ok_or(ImportError::InvalidFormat)?;
        copy_bounded(archive.by_name(&name)?, &temp.path)?;
    } else {
        copy_bounded(std::fs::File::open(source)?, &temp.path)?;
    }
    let mut magic = [0_u8; 16];
    let is_sqlite = std::io::Read::read_exact(&mut std::fs::File::open(&temp.path)?, &mut magic)
        .is_ok()
        && magic == *SQLITE_MAGIC;
    if !is_sqlite {
        return Err(ImportError::InvalidFormat);
    }
    Ok(temp)
}

/// Opens the copy for reading. `trusted_schema` off keeps its schema from running functions.
pub async fn open_read_only(temp: &TempDb) -> Result<SqlitePool, ImportError> {
    let options = SqliteConnectOptions::new()
        .filename(&temp.path)
        .read_only(true)
        .immutable(true)
        .create_if_missing(false)
        .foreign_keys(false)
        .pragma("query_only", "ON")
        .pragma("trusted_schema", "OFF");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    Ok(pool)
}

/// False unless every name is a plain table of the database.
pub async fn are_real_tables(pool: &SqlitePool, names: &[&str]) -> Result<bool, ImportError> {
    for name in names {
        let kind: Option<String> =
            sqlx::query_scalar("SELECT type FROM sqlite_master WHERE name = ?")
                .bind(*name)
                .fetch_optional(pool)
                .await?;
        if kind.as_deref() != Some("table") {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Runs one read with the row and time limits every query here shares.
pub async fn fetch_rows(
    pool: &SqlitePool,
    sql: &'static str,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, ImportError> {
    let query = sqlx::query(sql).bind(MAX_ROWS);
    match tokio::time::timeout(QUERY_TIME, query.fetch_all(pool)).await {
        Ok(rows) => Ok(rows?),
        Err(_) => Err(ImportError::TooLarge),
    }
}

/// A text column, whatever type a loosely typed database stored in it.
#[must_use]
pub fn text_at(row: &sqlx::sqlite::SqliteRow, index: usize) -> String {
    row.try_get::<Option<String>, _>(index)
        .ok()
        .flatten()
        .unwrap_or_default()
}

#[must_use]
pub fn int_at(row: &sqlx::sqlite::SqliteRow, index: usize) -> i64 {
    row.try_get::<Option<i64>, _>(index)
        .ok()
        .flatten()
        .unwrap_or(0)
}

#[cfg(test)]
pub(crate) mod test_db {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::path::Path;

    /// Builds a database file the way the other app would have, from plain SQL.
    pub async fn create(path: &Path, statements: &[&'static str]) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Delete);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        for statement in statements {
            sqlx::query(*statement).execute(&pool).await.unwrap();
        }
        pool.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::TempDir;
    use super::*;

    #[tokio::test]
    async fn the_copy_cannot_be_written_and_the_original_stays_as_it_was() {
        let dir = TempDir::new();
        let source = dir.0.join("newpipe.db");
        test_db::create(
            &source,
            &[
                "CREATE TABLE streams (uid INTEGER)",
                "INSERT INTO streams VALUES (1)",
            ],
        )
        .await;
        let before = std::fs::read(&source).unwrap();

        let temp = copy_to_temp(&source, "newpipe.db").unwrap();
        let temp_path = temp.path.clone();
        let temp_dir = temp.dir.clone();
        let pool = open_read_only(&temp).await.unwrap();
        assert!(
            sqlx::query("INSERT INTO streams VALUES (2)")
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query("CREATE TABLE more (a)")
                .execute(&pool)
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM streams")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool.close().await;

        assert_eq!(std::fs::read(&source).unwrap(), before);
        assert_eq!(std::fs::read(&temp_path).unwrap(), before);
        drop(temp);
        assert!(!temp_dir.exists(), "the copy goes away with the import");
    }

    #[tokio::test]
    async fn a_view_does_not_pass_for_a_table() {
        let dir = TempDir::new();
        let source = dir.0.join("hostile.db");
        test_db::create(
            &source,
            &[
                "CREATE TABLE real_one (a)",
                "CREATE VIEW streams AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c",
            ],
        )
        .await;
        let temp = copy_to_temp(&source, "x.db").unwrap();
        let pool = open_read_only(&temp).await.unwrap();
        assert!(are_real_tables(&pool, &["real_one"]).await.unwrap());
        assert!(!are_real_tables(&pool, &["streams"]).await.unwrap());
        assert!(!are_real_tables(&pool, &["missing"]).await.unwrap());
        pool.close().await;
    }

    #[test]
    fn a_file_that_is_no_database_is_refused() {
        let dir = TempDir::new();
        let not_db = dir.file("x.db", b"just some text, nothing more");
        assert!(matches!(
            copy_to_temp(&not_db, "x.db"),
            Err(ImportError::InvalidFormat)
        ));
        let zip_without = dir.zip("x.zip", &[("settings.preferences_pb", b"a")]);
        assert!(matches!(
            copy_to_temp(&zip_without, "song.db"),
            Err(ImportError::InvalidFormat)
        ));
    }
}
