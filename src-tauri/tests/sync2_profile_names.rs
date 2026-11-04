//! The FLOW-SYNC/2 `profiles` collection (spec/protocol.md, Profiles): names merge last-writer-wins
//! across devices, and a link deleted on one device stops syncing on the others.

mod sync2_common;

use flow_desktop_lib::sync::canonical::Hlc;
use flow_desktop_lib::sync2::engine::Session;
use flow_desktop_lib::sync2::profile_links::{link_profile, linked};
use flow_desktop_lib::sync2::profile_names::{ProfileRecord, merge, records, set};
use sync2_common::{device_pool, empty_pool, group};

const HOME: &str = "link-home";
const KIDS: &str = "link-kids";

fn record(link: &str, name: &str, ms: u64, deleted: bool) -> ProfileRecord {
    ProfileRecord {
        deleted,
        hlc: Hlc::new(ms, 0, "bbbbbbbb"),
        link: link.to_owned(),
        name: name.to_owned(),
    }
}

#[tokio::test]
async fn the_newest_name_wins() {
    let pool = empty_pool().await;
    merge(&pool, &[record(HOME, "Home", 200, false)])
        .await
        .unwrap();
    merge(&pool, &[record(HOME, "Older", 100, false)])
        .await
        .unwrap();
    assert_eq!(records(&pool).await.unwrap()[0].name, "Home");

    let deleted = merge(&pool, &[record(HOME, "Home", 300, true)])
        .await
        .unwrap();
    assert_eq!(deleted, [HOME]);
    assert!(records(&pool).await.unwrap()[0].deleted);
}

#[tokio::test]
async fn names_reach_other_devices_and_a_deleted_link_stops_syncing_there() {
    let g = group().await;
    let a_state = device_pool(&g).await;
    let mut a = Session::open(&a_state, &g.store, &g.a).await.unwrap();
    set(&a_state, "device-a", HOME, "Home", false)
        .await
        .unwrap();
    set(&a_state, "device-a", KIDS, "Kids", true).await.unwrap();
    a.push_profiles(&a_state).await.unwrap();
    let pushed = a.record().own_seq;
    a.push_profiles(&a_state).await.unwrap();
    assert_eq!(a.record().own_seq, pushed, "nothing new goes out again");

    let b_state = device_pool(&g).await;
    link_profile(&b_state, "kids-here", KIDS).await.unwrap();
    let mut b = Session::open(&b_state, &g.store, &g.b).await.unwrap();
    let pulled = b.pull(&b_state).await.unwrap();
    b.finish(&b_state, pulled).await.unwrap();

    let names: Vec<(String, String, bool)> = records(&b_state)
        .await
        .unwrap()
        .into_iter()
        .map(|r| (r.link, r.name, r.deleted))
        .collect();
    assert_eq!(
        names,
        [
            (HOME.to_owned(), "Home".to_owned(), false),
            (KIDS.to_owned(), "Kids".to_owned(), true)
        ]
    );
    assert!(linked(&b_state).await.unwrap().is_empty());
}
