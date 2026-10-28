//! Only the Default profile syncs (FLOW-SYNC/1 carries no profile): the manager itself refuses
//! to start a session anywhere else, before any socket or database work.

use flow_desktop_lib::sync::session::{SyncManager, SyncProfile};

fn manager(syncs_here: bool) -> SyncManager {
    SyncManager::new(SyncProfile {
        syncs_here,
        default_name: "Home".into(),
    })
}

#[tokio::test]
async fn another_profile_refuses_to_start_a_session() {
    let manager = manager(false);
    let error = manager.begin().await.expect_err("refused outside Default");
    assert_eq!(error.kind(), "syncNotDefaultProfile");
    assert_eq!(error.wire_code(), None, "no peer is involved yet");
    assert!(
        matches!(error, flow_desktop_lib::sync::error::SyncError::NotDefaultProfile(name) if name == "Home")
    );
    assert_eq!(manager.status().await.phase, "idle");
    assert!(!manager.syncs_here());
}

#[tokio::test]
async fn default_may_start_a_session() {
    let manager = manager(true);
    assert!(manager.begin().await.is_ok());
    assert!(manager.syncs_here());
    assert!(!manager.is_busy().await);
}
