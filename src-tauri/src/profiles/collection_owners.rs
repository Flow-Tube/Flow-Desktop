//! Downloads are shared by every profile, but a download collection made from a profile's own
//! playlist belongs to that profile. As on Android (`CollectionOwners.kt`), outside Default such
//! a collection is stored as `<profileId>:<playlistId>`; Default keeps the bare id. Flow mints
//! its own playlist and album ids as `playlist-<ms>`, `album-<ms>` and `watch-later`; YouTube
//! ids never look like that, so they stay bare and visible to every profile.

use super::{ActiveProfile, registry::is_safe_id};

fn is_own_playlist_id(id: &str) -> bool {
    let numbered = |prefix: &str| {
        id.strip_prefix(prefix)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
    };
    id == "watch-later" || numbered("playlist-") || numbered("album-")
}

/// The profile that owns a stored collection id, if it carries one.
pub fn owner(stored: &str) -> Option<&str> {
    stored
        .split_once(':')
        .map(|(owner, _)| owner)
        .filter(|owner| is_safe_id(owner))
}

/// The playlist or album id the app knows, without the owner.
pub fn playlist_id(stored: &str) -> &str {
    match owner(stored) {
        Some(owner) => &stored[owner.len() + 1..],
        None => stored,
    }
}

pub fn stored_id(active: &ActiveProfile, playlist_id: &str) -> String {
    if !active.is_default && is_own_playlist_id(playlist_id) {
        format!("{}{playlist_id}", prefix_of(&active.id))
    } else {
        playlist_id.to_string()
    }
}

pub fn visible_to(stored: &str, active: &ActiveProfile) -> bool {
    match owner(stored) {
        Some(owner) => !active.is_default && owner == active.id,
        None => !is_own_playlist_id(stored) || active.is_default,
    }
}

pub fn prefix_of(profile_id: &str) -> String {
    format!("{profile_id}:")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, is_default: bool) -> ActiveProfile {
        ActiveProfile {
            id: id.into(),
            is_default,
            after_switch: false,
            default_name: String::new(),
        }
    }

    #[test]
    fn own_playlists_carry_their_profile_outside_default() {
        let (default, study) = (profile("d", true), profile("study", false));
        assert_eq!(stored_id(&default, "playlist-17"), "playlist-17");
        assert_eq!(stored_id(&study, "playlist-17"), "study:playlist-17");
        assert_eq!(stored_id(&study, "watch-later"), "study:watch-later");
        assert_eq!(stored_id(&study, "PLabc"), "PLabc");
        assert_eq!(stored_id(&study, "MPREb_x"), "MPREb_x");
        assert_eq!(playlist_id("study:playlist-17"), "playlist-17");
        assert_eq!(playlist_id("PLabc"), "PLabc");
    }

    #[test]
    fn each_profile_sees_its_own_and_the_shared_ones() {
        let (default, study, gaming) = (
            profile("d", true),
            profile("study", false),
            profile("gaming", false),
        );
        assert!(visible_to("playlist-17", &default));
        assert!(!visible_to("playlist-17", &study));
        assert!(visible_to("study:playlist-17", &study));
        assert!(!visible_to("study:playlist-17", &gaming));
        assert!(!visible_to("study:playlist-17", &default));
        for shared in ["PLabc", "OLAK5uy_x", "RDCLAK5uy_mix"] {
            assert!(visible_to(shared, &default) && visible_to(shared, &study));
        }
    }

    #[test]
    fn only_a_safe_id_counts_as_an_owner() {
        assert_eq!(owner("a b:playlist-1"), None);
        assert_eq!(owner("study:playlist-1"), Some("study"));
        assert_eq!(owner("playlist-1"), None);
    }
}
