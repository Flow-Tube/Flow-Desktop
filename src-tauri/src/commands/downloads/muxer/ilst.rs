//! The iTunes-style `moov/udta/meta/ilst` tag block. The atom order and byte layout
//! follow Android's `IlstAtoms.kt`, so a file tagged by either app reads the same.

use super::boxes::{container, full_box, mp4_box};
use crate::commands::downloads::tags::{DownloadTags, TAG_NAMESPACE};

pub const MAX_COVER_BYTES: usize = 1_000_000;
const ENCODER_NAME: &str = "Flow";
const DATA_IMPLICIT: u32 = 0;
const DATA_UTF8: u32 = 1;
const DATA_JPEG: u32 = 13;
const DATA_PNG: u32 = 14;

/// Everything embedded in a file besides the media: tags, cover and chapters.
#[derive(Debug, Clone, Default)]
pub struct EmbeddedMetadata {
    pub tags: DownloadTags,
    /// JPEG or PNG bytes; anything else, or anything over 1 MB, is not embedded.
    pub cover: Option<Vec<u8>>,
}

/// `udta` holding `meta` (with an `mdir` handler) and the `ilst` atoms.
pub(super) fn udta_box(metadata: &EmbeddedMetadata) -> Vec<u8> {
    container(b"udta", &[meta_box(&ilst_box(metadata))])
}

pub(super) fn meta_box(ilst: &[u8]) -> Vec<u8> {
    // `meta` is a FullBox; the handler's reserved field carries "appl" as iTunes writes it.
    let mut handler = vec![0_u8; 8];
    handler.extend_from_slice(b"mdirappl");
    handler.extend_from_slice(&[0; 9]);
    let mut body = vec![0_u8; 4];
    body.extend(mp4_box(b"hdlr", &handler));
    body.extend_from_slice(ilst);
    mp4_box(b"meta", &body)
}

pub(super) fn ilst_box(metadata: &EmbeddedMetadata) -> Vec<u8> {
    let tags = &metadata.tags;
    let mut atoms: Vec<Vec<u8>> = Vec::new();
    push_text(&mut atoms, b"\xA9nam", Some(tags.title.clone()));
    push_text(&mut atoms, b"\xA9ART", tags.display_artist());
    push_text(&mut atoms, b"\xA9alb", tags.album.clone());
    push_text(&mut atoms, b"aART", tags.album_artist.clone());
    if let Some(number) = tags.track_number.filter(|number| *number > 0) {
        atoms.push(track_number_atom(number, tags.track_total.unwrap_or(0)));
    }
    push_text(&mut atoms, b"\xA9day", tags.release_date.clone());
    push_text(&mut atoms, b"\xA9gen", tags.genre.clone());
    push_text(&mut atoms, b"\xA9cmt", tags.source_url());
    push_text(&mut atoms, b"desc", tags.truncated_description());
    push_text(&mut atoms, b"\xA9lyr", tags.lyrics.clone());
    push_text(&mut atoms, b"\xA9too", Some(ENCODER_NAME.to_string()));
    if let Some(atom) = metadata.cover.as_deref().and_then(cover_atom) {
        atoms.push(atom);
    }
    for (name, value) in tags.flow_fields() {
        atoms.push(freeform_atom(name, &value));
    }
    container(b"ilst", &atoms)
}

/// JPEG → 13, PNG → 14; anything else, or an oversized image, is not embedded.
pub(super) fn cover_data_type(bytes: &[u8]) -> Option<u32> {
    if bytes.len() > MAX_COVER_BYTES {
        None
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(DATA_JPEG)
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some(DATA_PNG)
    } else {
        None
    }
}

fn push_text(atoms: &mut Vec<Vec<u8>>, kind: &[u8], value: Option<String>) {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return;
    };
    atoms.push(mp4_box(kind, &data_atom(DATA_UTF8, value.as_bytes())));
}

fn data_atom(data_type: u32, value: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(8 + value.len());
    payload.extend_from_slice(&data_type.to_be_bytes());
    payload.extend_from_slice(&0_u32.to_be_bytes());
    payload.extend_from_slice(value);
    mp4_box(b"data", &payload)
}

fn track_number_atom(number: u32, total: u32) -> Vec<u8> {
    let number = u16::try_from(number).unwrap_or(u16::MAX);
    let total = u16::try_from(total).unwrap_or(u16::MAX);
    let mut payload = vec![0, 0];
    payload.extend_from_slice(&number.to_be_bytes());
    payload.extend_from_slice(&total.to_be_bytes());
    payload.extend_from_slice(&[0, 0]);
    mp4_box(b"trkn", &data_atom(DATA_IMPLICIT, &payload))
}

fn cover_atom(bytes: &[u8]) -> Option<Vec<u8>> {
    let data_type = cover_data_type(bytes)?;
    Some(mp4_box(b"covr", &data_atom(data_type, bytes)))
}

fn freeform_atom(name: &str, value: &str) -> Vec<u8> {
    container(
        b"----",
        &[
            full_box(b"mean", 0, 0, TAG_NAMESPACE.as_bytes()),
            full_box(b"name", 0, 0, name.as_bytes()),
            data_atom(DATA_UTF8, value.as_bytes()),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::{EmbeddedMetadata, cover_data_type, ilst_box, track_number_atom, udta_box};
    use crate::commands::downloads::tags::{DownloadTags, TagKind};

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    #[test]
    fn track_number_matches_android_layout() {
        assert_eq!(
            track_number_atom(3, 12),
            vec![
                0, 0, 0, 32, b't', b'r', b'k', b'n', //
                0, 0, 0, 24, b'd', b'a', b't', b'a', 0, 0, 0, 0, 0, 0, 0, 0, //
                0, 0, 0, 3, 0, 12, 0, 0,
            ]
        );
    }

    #[test]
    fn text_atoms_use_utf8_data_type() {
        let metadata = EmbeddedMetadata {
            tags: DownloadTags {
                title: "Ünïcode".into(),
                video_id: "id".into(),
                ..DownloadTags::default()
            },
            cover: None,
        };
        let ilst = ilst_box(&metadata);
        let at = find(&ilst, b"\xA9nam").expect("title atom");
        let data = &ilst[at + 4..];
        assert_eq!(&data[4..8], b"data");
        assert_eq!(&data[8..12], &[0, 0, 0, 1]);
        assert_eq!(&data[16..16 + "Ünïcode".len()], "Ünïcode".as_bytes());
    }

    #[test]
    fn freeform_atoms_carry_the_flow_namespace() {
        let metadata = EmbeddedMetadata {
            tags: DownloadTags {
                kind: TagKind::Music,
                title: "Song".into(),
                video_id: "abc123".into(),
                ..DownloadTags::default()
            },
            cover: None,
        };
        let ilst = ilst_box(&metadata);
        let mean = find(&ilst, b"mean").expect("mean atom");
        // mean is a FullBox: 4 zero bytes, then the namespace.
        assert_eq!(&ilst[mean + 4..mean + 8], &[0, 0, 0, 0]);
        assert_eq!(
            &ilst[mean + 8..mean + 8 + "io.github.aedev.flow".len()],
            b"io.github.aedev.flow"
        );
        assert!(find(&ilst, b"videoId").is_some());
        assert!(find(&ilst, b"abc123").is_some());
        assert!(find(&ilst, b"MUSIC").is_some());
    }

    #[test]
    fn cover_types_are_sniffed_and_capped() {
        assert_eq!(cover_data_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(13));
        assert_eq!(cover_data_type(&[0x89, 0x50, 0x4E, 0x47, 0x0D]), Some(14));
        assert_eq!(cover_data_type(b"RIFF....WEBP"), None);
        let mut big = vec![0xFF, 0xD8, 0xFF];
        big.resize(1_000_001, 0);
        assert_eq!(cover_data_type(&big), None);
    }

    #[test]
    fn udta_wraps_meta_with_an_mdir_handler() {
        let udta = udta_box(&EmbeddedMetadata::default());
        assert_eq!(&udta[4..8], b"udta");
        assert_eq!(&udta[12..16], b"meta");
        assert_eq!(&udta[16..20], &[0, 0, 0, 0]);
        assert_eq!(&udta[24..28], b"hdlr");
        assert_eq!(&udta[36..44], b"mdirappl");
        assert!(find(&udta, b"ilst").is_some());
        assert!(find(&udta, b"\xA9too").is_some());
    }
}
