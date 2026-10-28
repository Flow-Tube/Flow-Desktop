//! Upgrade and downgrade check on a real database from a build without profiles. It needs a copy
//! of one, so it is ignored by default:
//!
//!   FLOW_UPGRADE_DB=/path/to/copy/flow-desktop.sqlite \
//!     cargo test --test profile_upgrade -- --ignored --nocapture
//!
//! The copy is moved into a temporary app data folder and never written back.

use std::collections::BTreeMap;
use std::path::Path;

use flow_desktop_lib::profiles::{ActiveProfile, load_for_process, open_database};

async fn snapshot(path: &Path) -> (BTreeMap<String, i64>, Vec<i64>) {
    let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let mut rows = BTreeMap::new();
    for table in tables {
        let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM \"{table}\""
        )))
        .fetch_one(&pool)
        .await
        .unwrap();
        rows.insert(table, count);
    }
    let versions: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    pool.close().await;
    (rows, versions)
}

#[tokio::test]
#[ignore = "needs FLOW_UPGRADE_DB, a copy of a real database"]
async fn a_database_from_before_profiles_opens_as_default_and_stays_readable_by_older_builds() {
    let source = std::env::var("FLOW_UPGRADE_DB").expect("set FLOW_UPGRADE_DB");
    let dir = std::env::temp_dir().join(format!("flow-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("flow-desktop.sqlite");
    std::fs::copy(&source, &db).unwrap();
    let (before_rows, before_versions) = snapshot(&db).await;

    // Upgrade: the first start writes the registry and opens Default on today's file.
    let (default, warning) = load_for_process(&dir);
    assert!(warning.is_none() && default.is_default);
    let pool = open_database(&dir, &default).await.unwrap();
    pool.close().await;
    let (after_rows, after_versions) = snapshot(&db).await;
    assert_eq!(
        after_versions, before_versions,
        "no migration an older build doesn't know"
    );
    for (table, count) in &before_rows {
        // The open prunes the recommendation event log to its usual 2,000 rows.
        if table != "recommendation_events" {
            assert_eq!(after_rows.get(table), Some(count), "{table} changed");
        }
    }
    println!(
        "tables: {}, migrations: {:?}",
        after_rows.len(),
        after_versions.last()
    );
    println!(
        "watch_history: {:?}, downloads: {:?}",
        after_rows.get("watch_history"),
        after_rows.get("downloads")
    );

    // A second profile gets its own file; Default's stays as an older build expects it.
    let study = ActiveProfile {
        id: "study".into(),
        is_default: false,
        after_switch: false,
        default_name: String::new(),
    };
    let study_pool = open_database(&dir, &study).await.unwrap();
    study_pool.close().await;
    let (study_rows, _) = snapshot(&dir.join("profiles/study/flow-desktop.sqlite")).await;
    assert_eq!(study_rows.get("watch_history"), Some(&0));
    assert_eq!(
        snapshot(&db).await.1,
        before_versions,
        "older builds still open Default"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
