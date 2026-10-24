//! The offline queues: listens and loves waiting for each service, oldest first, capped at
//! [`MAX_QUEUE`] per service so a long offline stretch keeps the newest.

use sqlx::{Row, SqlitePool};

use super::models::{LoveEntry, ScrobbleEntry, Service};
use crate::errors::AppResult;

pub const MAX_QUEUE: i64 = 2_000;

/// A queued row with the id it is dropped by once sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queued<T> {
    pub id: i64,
    pub item: T,
}

pub async fn enqueue(pool: &SqlitePool, service: Service, entry: &ScrobbleEntry) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO scrobble_queue (service, artist, title, album, duration_sec, timestamp_sec, from_youtube)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(service.as_str())
    .bind(&entry.artist)
    .bind(&entry.title)
    .bind(&entry.album)
    .bind(i64::from(entry.duration_sec))
    .bind(entry.timestamp_sec)
    .bind(entry.from_youtube)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM scrobble_queue WHERE service = ?1 AND id NOT IN
         (SELECT id FROM scrobble_queue WHERE service = ?1 ORDER BY id DESC LIMIT ?2)",
    )
    .bind(service.as_str())
    .bind(MAX_QUEUE)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn pending(
    pool: &SqlitePool,
    service: Service,
    limit: usize,
) -> AppResult<Vec<Queued<ScrobbleEntry>>> {
    let rows = sqlx::query(
        "SELECT id, artist, title, album, duration_sec, timestamp_sec, from_youtube
         FROM scrobble_queue WHERE service = ? ORDER BY id LIMIT ?",
    )
    .bind(service.as_str())
    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Queued {
            id: row.get("id"),
            item: ScrobbleEntry {
                artist: row.get("artist"),
                title: row.get("title"),
                album: row.get("album"),
                duration_sec: u32::try_from(row.get::<i64, _>("duration_sec")).unwrap_or(0),
                timestamp_sec: row.get("timestamp_sec"),
                from_youtube: row.get("from_youtube"),
            },
        })
        .collect())
}

pub async fn drop_sent<T>(pool: &SqlitePool, table: Table, sent: &[Queued<T>]) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for queued in sent {
        sqlx::query(table.delete_sql())
            .bind(queued.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub enum Table {
    Listens,
    Loves,
}

impl Table {
    fn delete_sql(self) -> &'static str {
        match self {
            Table::Listens => "DELETE FROM scrobble_queue WHERE id = ?",
            Table::Loves => "DELETE FROM scrobble_loves WHERE id = ?",
        }
    }
}

pub async fn enqueue_love(pool: &SqlitePool, service: Service, love: &LoveEntry) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO scrobble_loves (service, artist, title, loved) VALUES (?, ?, ?, ?)")
        .bind(service.as_str())
        .bind(&love.artist)
        .bind(&love.title)
        .bind(love.loved)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM scrobble_loves WHERE service = ?1 AND id NOT IN
         (SELECT id FROM scrobble_loves WHERE service = ?1 ORDER BY id DESC LIMIT ?2)",
    )
    .bind(service.as_str())
    .bind(MAX_QUEUE)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn pending_loves(
    pool: &SqlitePool,
    service: Service,
) -> AppResult<Vec<Queued<LoveEntry>>> {
    let rows = sqlx::query(
        "SELECT id, artist, title, loved FROM scrobble_loves WHERE service = ? ORDER BY id",
    )
    .bind(service.as_str())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Queued {
            id: row.get("id"),
            item: LoveEntry {
                artist: row.get("artist"),
                title: row.get("title"),
                loved: row.get("loved"),
            },
        })
        .collect())
}

/// How many listens and loves are still waiting for this service.
pub async fn waiting(pool: &SqlitePool, service: Service) -> AppResult<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM scrobble_queue WHERE service = ?1)
              + (SELECT COUNT(*) FROM scrobble_loves WHERE service = ?1)",
    )
    .bind(service.as_str())
    .fetch_one(pool)
    .await?;
    Ok(count)
}

/// Signing out drops what was waiting for that account.
pub async fn clear(pool: &SqlitePool, service: Service) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for sql in [
        "DELETE FROM scrobble_queue WHERE service = ?",
        "DELETE FROM scrobble_loves WHERE service = ?",
    ] {
        sqlx::query(sql)
            .bind(service.as_str())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn entry(n: i64) -> ScrobbleEntry {
        ScrobbleEntry {
            artist: "Artist".into(),
            title: format!("Song {n}"),
            album: String::new(),
            duration_sec: 200,
            timestamp_sec: n,
            from_youtube: true,
        }
    }

    #[tokio::test]
    async fn listens_come_back_oldest_first_per_service_and_leave_once_sent() {
        let pool = pool().await;
        for n in 1..=3 {
            enqueue(&pool, Service::LastFm, &entry(n)).await.unwrap();
        }
        enqueue(&pool, Service::ListenBrainz, &entry(9))
            .await
            .unwrap();

        let batch = pending(&pool, Service::LastFm, 2).await.unwrap();
        assert_eq!(
            batch
                .iter()
                .map(|q| q.item.timestamp_sec)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        drop_sent(&pool, Table::Listens, &batch).await.unwrap();

        let rest = pending(&pool, Service::LastFm, 50).await.unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].item, entry(3));
        assert_eq!(waiting(&pool, Service::ListenBrainz).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn each_service_keeps_only_the_newest_two_thousand() {
        let pool = pool().await;
        for n in 0..(MAX_QUEUE + 5) {
            enqueue(&pool, Service::LibreFm, &entry(n)).await.unwrap();
        }
        enqueue(&pool, Service::LastFm, &entry(1)).await.unwrap();

        assert_eq!(waiting(&pool, Service::LibreFm).await.unwrap(), MAX_QUEUE);
        let oldest = pending(&pool, Service::LibreFm, 1).await.unwrap();
        assert_eq!(oldest[0].item.timestamp_sec, 5);
        assert_eq!(waiting(&pool, Service::LastFm).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn loves_queue_with_listens_and_clearing_drops_both() {
        let pool = pool().await;
        let love = LoveEntry {
            artist: "A".into(),
            title: "Song".into(),
            loved: true,
        };
        enqueue_love(&pool, Service::LastFm, &love).await.unwrap();
        enqueue(&pool, Service::LastFm, &entry(1)).await.unwrap();
        assert_eq!(waiting(&pool, Service::LastFm).await.unwrap(), 2);
        assert_eq!(
            pending_loves(&pool, Service::LastFm).await.unwrap()[0].item,
            love
        );

        clear(&pool, Service::LastFm).await.unwrap();
        assert_eq!(waiting(&pool, Service::LastFm).await.unwrap(), 0);
    }
}
