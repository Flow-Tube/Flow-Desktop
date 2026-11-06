//! The recap ledger: what was watched and listened to, month by month, kept on this device so a
//! recap can name a channel long after the engines have pruned it. A port of Flow for Android's
//! `data/stats` and `MusicListeningStats`. It goes into master backups as Android's does and is
//! never synced. Video and music stay in separate records.

pub mod backfill;
pub mod model;
pub mod ops;
pub mod store;
pub mod summary;
