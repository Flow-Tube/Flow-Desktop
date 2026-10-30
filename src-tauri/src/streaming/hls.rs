//! AAC from `YouTube` is fragmented MP4, which `WebKit` reads to the end before it reports anything:
//! at googlevideo's pace for it (about 150 KB/s) a song takes 8 to 18 s to start. Served as an HLS
//! playlist over the same bytes (the init segment, then one segment per fragment, from the file's
//! `sidx`), it starts after the first fragment, about a second.

use std::fmt::Write;
use std::sync::OnceLock;

use mp4_atom::{Decode, FourCC, Header, Sidx};

/// Set to `false` to serve AAC as a plain file again, should `WebAudio` not hear it as HLS.
pub const SERVE_AAC_AS_HLS: bool = true;

/// Enough of the file to hold `ftyp`, `moov` and `sidx`, which come first.
const HEAD_BYTES: usize = 32 * 1024;

struct Segment {
    offset: u64,
    size: u32,
    seconds: f64,
}

/// Where the init segment ends, and each fragment's place, length and duration.
fn fragments(head: &[u8]) -> Option<(u64, Vec<Segment>)> {
    let mut rest = head;
    let mut init_end = None;
    loop {
        let start = (head.len() - rest.len()) as u64;
        let mut body = rest;
        let header = Header::decode(&mut body).ok()?;
        let length = rest.len() - body.len() + header.size?;
        let end = start + length as u64;
        if header.kind == FourCC::new(b"moov") {
            init_end = Some(end);
        }
        if header.kind == FourCC::new(b"sidx") {
            let sidx = Sidx::decode(&mut rest).ok()?;
            // A reference to another index (a hierarchical sidx) isn't a fragment.
            if sidx.timescale == 0 || sidx.references.iter().any(|r| r.reference_type) {
                return None;
            }
            let mut offset = end + sidx.first_offset;
            let segments = sidx
                .references
                .iter()
                .map(|reference| {
                    let segment = Segment {
                        offset,
                        size: reference.referenced_size,
                        seconds: f64::from(reference.subsegment_duration)
                            / f64::from(sidx.timescale),
                    };
                    offset += u64::from(reference.referenced_size);
                    segment
                })
                .collect();
            return Some((init_end?, segments));
        }
        rest = rest.get(length..)?;
    }
}

/// A VOD playlist over the file at `media`, or `None` when `head` doesn't index it.
fn playlist(head: &[u8], media: &str) -> Option<String> {
    let (init_end, segments) = fragments(head)?;
    let longest = segments
        .iter()
        .map(|s| s.seconds)
        .fold(0.0, f64::max)
        .ceil();
    let mut text = format!(
        "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:{longest}\n#EXT-X-PLAYLIST-TYPE:VOD\n\
         #EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI=\"{media}\",BYTERANGE=\"{init_end}@0\"\n"
    );
    for segment in &segments {
        let _ = write!(
            text,
            "#EXTINF:{:.3},\n#EXT-X-BYTERANGE:{}@{}\n{media}\n",
            segment.seconds, segment.size, segment.offset
        );
    }
    text.push_str("#EXT-X-ENDLIST\n");
    Some(text)
}

/// The playlist for the audio served at `media` on this proxy, from the start of the file.
pub async fn aac_playlist(port: u16, media: &str) -> Option<String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let head = CLIENT
        .get_or_init(reqwest::Client::new)
        .get(format!("http://127.0.0.1:{port}{media}"))
        .header("Range", format!("bytes=0-{}", HEAD_BYTES - 1))
        .send()
        .await
        .ok()?
        .bytes()
        .await
        .ok()?;
    playlist(&head, media)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `ftyp`, an empty `moov`, and a `sidx` of two fragments at 44.1 kHz.
    fn head() -> Vec<u8> {
        let mut file = Vec::new();
        file.extend_from_slice(&[0, 0, 0, 16]);
        file.extend_from_slice(b"ftypdash\0\0\0\0");
        file.extend_from_slice(&[0, 0, 0, 8]);
        file.extend_from_slice(b"moov");
        let sidx_start = file.len();
        file.extend_from_slice(&[0, 0, 0, 0]);
        file.extend_from_slice(b"sidx");
        file.extend_from_slice(&[0, 0, 0, 0]); // version 0, flags
        file.extend_from_slice(&1u32.to_be_bytes()); // reference id
        file.extend_from_slice(&44_100u32.to_be_bytes()); // timescale
        file.extend_from_slice(&0u32.to_be_bytes()); // earliest presentation time
        file.extend_from_slice(&10u32.to_be_bytes()); // first offset
        file.extend_from_slice(&0u16.to_be_bytes());
        file.extend_from_slice(&2u16.to_be_bytes());
        for (size, duration) in [(1000u32, 441_000u32), (500, 220_500)] {
            file.extend_from_slice(&size.to_be_bytes());
            file.extend_from_slice(&duration.to_be_bytes());
            file.extend_from_slice(&0x9000_0000u32.to_be_bytes());
        }
        let sidx_size = u32::try_from(file.len() - sidx_start).unwrap();
        file[sidx_start..sidx_start + 4].copy_from_slice(&sidx_size.to_be_bytes());
        file
    }

    #[test]
    fn a_fragmented_file_becomes_a_byte_range_playlist() {
        let head = head();
        let sidx_end = head.len() as u64;
        let text = playlist(&head, "/stream/song").unwrap();
        let first = sidx_end + 10;
        assert_eq!(
            text,
            format!(
                "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:10\n#EXT-X-PLAYLIST-TYPE:VOD\n\
                 #EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI=\"/stream/song\",BYTERANGE=\"24@0\"\n\
                 #EXTINF:10.000,\n#EXT-X-BYTERANGE:1000@{first}\n/stream/song\n\
                 #EXTINF:5.000,\n#EXT-X-BYTERANGE:500@{}\n/stream/song\n#EXT-X-ENDLIST\n",
                first + 1000
            )
        );
    }

    #[test]
    fn a_file_without_an_index_stays_a_plain_file() {
        let head = head();
        assert!(playlist(&head[..24], "/stream/song").is_none());
    }
}
