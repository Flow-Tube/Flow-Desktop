//! What live messages keep on a device (spec/live.md): a counter that never repeats, the highest
//! counter accepted from each sender, and the user's answer for each device.

mod sync2_common;

use flow_desktop_lib::sync2::live_state::{accept_live_seq, consents, next_live_seq, set_consent};
use flow_desktop_lib::sync2::state::forget_group;
use sync2_common::{device_pool, group};

#[tokio::test]
async fn the_counter_only_goes_up() {
    let pool = device_pool(&group().await).await;
    assert_eq!(next_live_seq(&pool).await.unwrap(), 1);
    assert_eq!(next_live_seq(&pool).await.unwrap(), 2);
}

#[tokio::test]
async fn a_sender_s_counter_is_taken_once_and_never_backwards() {
    let pool = device_pool(&group().await).await;
    assert!(accept_live_seq(&pool, "aa", 5).await.unwrap());
    assert!(!accept_live_seq(&pool, "aa", 5).await.unwrap(), "a replay");
    assert!(
        !accept_live_seq(&pool, "aa", 4).await.unwrap(),
        "an older one"
    );
    assert!(accept_live_seq(&pool, "aa", 6).await.unwrap());
    assert!(
        accept_live_seq(&pool, "bb", 1).await.unwrap(),
        "counters are per sender"
    );
}

#[tokio::test]
async fn answers_are_remembered_changed_and_forgotten_with_the_group() {
    let pool = device_pool(&group().await).await;
    set_consent(&pool, "aa", Some(true)).await.unwrap();
    set_consent(&pool, "bb", Some(false)).await.unwrap();
    set_consent(&pool, "bb", Some(true)).await.unwrap();
    set_consent(&pool, "cc", Some(false)).await.unwrap();
    set_consent(&pool, "cc", None).await.unwrap();
    let answers = consents(&pool).await.unwrap();
    assert_eq!(
        answers.into_iter().collect::<Vec<_>>(),
        [("aa".into(), true), ("bb".into(), true)]
    );

    accept_live_seq(&pool, "aa", 9).await.unwrap();
    forget_group(&pool).await.unwrap();
    assert!(consents(&pool).await.unwrap().is_empty());
    assert!(accept_live_seq(&pool, "aa", 1).await.unwrap());
}
