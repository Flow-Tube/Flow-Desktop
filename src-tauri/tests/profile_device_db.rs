//! A non-Default profile opens its own database, and reads the rows every profile shares from
//! Default's. Runs in its own test binary because the device pool is process-wide.

use flow_desktop_lib::profiles::{ActiveProfile, open_database};
use flow_desktop_lib::sync::ledger::get_or_create_device_id;

async fn identity_rows(path: &std::path::Path) -> i64 {
    let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    let rows = sqlx::query_scalar("SELECT COUNT(*) FROM sync_identity")
        .fetch_one(&pool)
        .await
        .unwrap();
    pool.close().await;
    rows
}

#[tokio::test]
async fn another_profile_shares_defaults_device_rows() {
    let dir = std::env::temp_dir().join(format!("flow-device-db-{}", uuid::Uuid::new_v4()));
    let study = ActiveProfile {
        id: "study".into(),
        is_default: false,
        after_switch: false,
    };

    let pool = open_database(&dir, &study).await.unwrap();
    let id = get_or_create_device_id(&pool).await.unwrap();
    assert_eq!(get_or_create_device_id(&pool).await.unwrap(), id);
    pool.close().await;

    let study_file = dir.join("profiles/study/flow-desktop.sqlite");
    assert!(study_file.exists(), "the profile has its own database");
    assert_eq!(
        identity_rows(&dir.join("flow-desktop.sqlite")).await,
        1,
        "device id lives in Default's file"
    );
    assert_eq!(
        identity_rows(&study_file).await,
        0,
        "never minted in the profile's file"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
