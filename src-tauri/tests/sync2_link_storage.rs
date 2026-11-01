//! Migration 0036 carries a group's upload ledger over to the ledger kept per link.

use sqlx::SqlitePool;
use sqlx::migrate::Migrator;
use sqlx::sqlite::SqlitePoolOptions;

const BEFORE_PROFILES: usize = 35;

async fn migrated_to(count: usize) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut migrator: Migrator = sqlx::migrate!("./migrations");
    migrator.migrations = migrator.migrations[..count].to_vec().into();
    migrator.run(&pool).await.unwrap();
    pool
}

async fn group_with_link(pool: &SqlitePool, link: &str) {
    sqlx::query(
        "INSERT INTO sync2_group (id, group_id, kind, store_url, link, own_seq, own_prev, cursor)
         VALUES (1, 'g', 'server', 'https://s', ?, 0, '', 0)",
    )
    .bind(link)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO sync2_sent (collection, record_key, hash, sent_at) VALUES ('likes', 'video:a', 'h', 7)")
        .execute(pool)
        .await
        .unwrap();
}

async fn finish(pool: &SqlitePool) {
    sqlx::migrate!("./migrations").run(pool).await.unwrap();
}

#[tokio::test]
async fn a_linked_group_keeps_what_it_sent_under_its_link() {
    let pool = migrated_to(BEFORE_PROFILES).await;
    group_with_link(&pool, "link-a").await;
    finish(&pool).await;

    let sent: Vec<(String, String, String, String, i64)> =
        sqlx::query_as("SELECT link, collection, record_key, hash, sent_at FROM sync2_sent_links")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        sent,
        [(
            "link-a".to_owned(),
            "likes".to_owned(),
            "video:a".to_owned(),
            "h".to_owned(),
            7
        )]
    );
}

#[tokio::test]
async fn a_restored_group_without_a_link_carries_nothing_over() {
    let pool = migrated_to(BEFORE_PROFILES).await;
    group_with_link(&pool, "").await;
    finish(&pool).await;

    let sent: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync2_sent_links")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sent, 0);
}
