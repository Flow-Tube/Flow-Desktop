//!CRDT primitive-law tests for Flow Local Sync.
//!
//! These assert the laws that guarantee conflict-free convergence — commutativity, associativity
//! (covered structurally by the per-device representations), and **idempotency** — for the merge
//! primitives (`Hlc`, `GCounter`, `OrSet`, `Lww`), plus the stability of the wire enums/frame
//! byte-values. They live in an integration test because this crate links Tauri's cdylib and the
//! in-crate unit-test harness fails to launch on Windows (STATUS_ENTRYPOINT_NOT_FOUND); the
//! integration target links the crate as a plain rlib and runs cleanly.

use std::str::FromStr;

use flow_desktop_lib::sync::canonical::{Collection, GCounter, Hlc, Lww, OrSet};
use flow_desktop_lib::sync::frames::{FrameType, SelectionFrame};

#[test]
fn hlc_roundtrips_through_string() {
    // the wire form carries the short device-id (hyphen-stripped, lowercased, first 8 chars),
    // so "device-aaa" → "deviceaa".
    let h = Hlc::new(1_781_512_000_000, 3, "device-aaa");
    assert_eq!(h.to_string(), "1781512000000:3:deviceaa");
    assert_eq!(Hlc::from_str(&h.to_string()).unwrap(), h);
}

#[test]
fn hlc_total_order_is_physical_then_counter_then_device() {
    let a = Hlc::new(100, 0, "z");
    let b = Hlc::new(100, 1, "a");
    let c = Hlc::new(101, 0, "a");
    assert!(a < b, "higher counter wins at equal physical time");
    assert!(b < c, "higher physical time wins regardless of counter");
    // device_id only breaks an otherwise exact tie
    assert!(Hlc::new(100, 0, "a") < Hlc::new(100, 0, "b"));
}

#[test]
fn gcounter_sums_disjoint_and_is_idempotent() {
    let mut a = GCounter::single("d1", 5);
    let b = GCounter::single("d2", 7);
    a.merge(&b);
    assert_eq!(a.total(), 12, "disjoint devices sum");

    // Re-merging the same payload changes nothing — the core no-double-counting guarantee.
    let before = a.clone();
    a.merge(&b);
    a.merge(&b);
    assert_eq!(a, before, "G-Counter merge is idempotent");
}

#[test]
fn gcounter_merge_is_commutative_and_associative() {
    let d1 = GCounter::single("d1", 5);
    let d2 = GCounter::single("d2", 7);
    let d3 = GCounter::single("d3", 9);

    let mut ab = d1.clone();
    ab.merge(&d2);
    let mut ba = d2.clone();
    ba.merge(&d1);
    assert_eq!(ab, ba, "commutative");

    // (d1 ∘ d2) ∘ d3 == d1 ∘ (d2 ∘ d3)
    let mut left = ab.clone();
    left.merge(&d3);
    let mut d23 = d2.clone();
    d23.merge(&d3);
    let mut right = d1.clone();
    right.merge(&d23);
    assert_eq!(left, right, "associative");
}

#[test]
fn orset_add_wins_on_tie_and_unblock_propagates() {
    let mut s = OrSet::default();
    s.add("politics", Hlc::new(100, 0, "d1"));
    assert!(s.contains("politics"));
    // a later remove (unblock) wins
    s.remove("politics", Hlc::new(200, 0, "d1"));
    assert!(!s.contains("politics"));
    // a still-later re-add wins again
    s.add("politics", Hlc::new(300, 0, "d1"));
    assert!(s.contains("politics"));
    // add-wins on an exact stamp tie
    let mut t = OrSet::default();
    t.add("x", Hlc::new(100, 0, "d1"));
    t.remove("x", Hlc::new(100, 0, "d1"));
    assert!(t.contains("x"), "add wins on tie");
}

#[test]
fn orset_union_merge_is_commutative_and_idempotent() {
    let mut a = OrSet::default();
    a.add("x", Hlc::new(100, 0, "d1"));
    let mut b = OrSet::default();
    b.add("y", Hlc::new(150, 0, "d2"));
    b.remove("x", Hlc::new(120, 0, "d2"));

    let mut ab = a.clone();
    ab.merge(&b);
    let mut ba = b.clone();
    ba.merge(&a);
    assert_eq!(ab.members(), ba.members(), "union merge is commutative");
    // x was added@100 then removed@120 ⇒ not a member; y is
    assert_eq!(ab.members(), vec!["y".to_string()]);

    let snapshot = ab.clone();
    ab.merge(&b);
    ab.merge(&a);
    assert_eq!(
        ab.members(),
        snapshot.members(),
        "union merge is idempotent"
    );
}

#[test]
fn lww_keeps_the_higher_stamp_and_is_idempotent() {
    let mut reg = Lww::new(1u64, Hlc::new(100, 0, "d1"));
    reg.merge(&Lww::new(2u64, Hlc::new(90, 0, "d2")));
    assert_eq!(reg.value, 1, "older write does not win");
    reg.merge(&Lww::new(3u64, Hlc::new(110, 0, "d2")));
    assert_eq!(reg.value, 3, "newer write wins");

    let before = reg.clone();
    reg.merge(&Lww::new(3u64, Hlc::new(110, 0, "d2")));
    assert_eq!(reg, before, "re-applying the same write is a no-op");
}

#[test]
fn frame_type_byte_values_are_stable() {
    assert_eq!(FrameType::Hello.to_u8(), 0x01);
    assert_eq!(FrameType::Manifest.to_u8(), 0x10);
    assert_eq!(FrameType::Error.to_u8(), 0x7F);
    assert_eq!(FrameType::from_u8(0x12), Some(FrameType::ChunkAck));
    assert_eq!(FrameType::from_u8(0x99), None);
}

#[test]
fn collection_serializes_snake_case() {
    let s = SelectionFrame {
        send: vec![Collection::WatchHistory, Collection::FlowNeuroBrain],
        accept: vec![Collection::Likes],
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["send"][0], "watch_history");
    assert_eq!(v["send"][1], "flow_neuro_brain");
    assert_eq!(v["accept"][0], "likes");
}

#[test]
fn selection_drops_collections_this_build_does_not_know() {
    // Android 2.3 adds `notes`; one unknown name used to fail the whole frame and end the session.
    let s: SelectionFrame = serde_json::from_str(
        r#"{"send":["watch_history","notes","likes"],"accept":["notes","future_thing"]}"#,
    )
    .unwrap();
    assert_eq!(s.send, vec![Collection::WatchHistory, Collection::Likes]);
    assert!(s.accept.is_empty());
}
