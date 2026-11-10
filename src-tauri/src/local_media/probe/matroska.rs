//! Reads the headers of a Matroska or `WebM` file: length, picture size and each track's codec.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::ContainerInfo;

const EBML_HEADER: u32 = 0x1A45_DFA3;
const SEGMENT: u32 = 0x1853_8067;
const INFO: u32 = 0x1549_A966;
const TRACKS: u32 = 0x1654_AE6B;
const TIMECODE_SCALE: u32 = 0x2A_D7B1;
const DURATION: u32 = 0x4489;
const TITLE: u32 = 0x7BA9;
const TRACK_ENTRY: u32 = 0xAE;
const TRACK_TYPE: u32 = 0x83;
const CODEC_ID: u32 = 0x86;
const DEFAULT_DURATION: u32 = 0x23_E383;
const VIDEO: u32 = 0xE0;
const PIXEL_WIDTH: u32 = 0xB0;
const PIXEL_HEIGHT: u32 = 0xBA;

const MAX_HEADER_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SEGMENT_ELEMENTS: usize = 4096;
const DEFAULT_TIMECODE_SCALE: u64 = 1_000_000;

pub fn read(path: &Path) -> Option<ContainerInfo> {
    read_from(&mut File::open(path).ok()?)
}

fn read_from(file: &mut (impl Read + Seek)) -> Option<ContainerInfo> {
    let (id, size) = element_header(file)?;
    if id != EBML_HEADER {
        return None;
    }
    file.seek(SeekFrom::Current(i64::try_from(size?).ok()?))
        .ok()?;
    let (id, _) = element_header(file)?;
    if id != SEGMENT {
        return None;
    }

    let mut info = ContainerInfo::default();
    let (mut saw_info, mut saw_tracks) = (false, false);
    for _ in 0..MAX_SEGMENT_ELEMENTS {
        let Some((id, size)) = element_header(file) else {
            break;
        };
        match (id, size) {
            (INFO, Some(size)) if size <= MAX_HEADER_BYTES => {
                parse_info(&read_body(file, size)?, &mut info);
                saw_info = true;
            }
            (TRACKS, Some(size)) if size <= MAX_HEADER_BYTES => {
                parse_tracks(&read_body(file, size)?, &mut info);
                saw_tracks = true;
            }
            (_, Some(size)) => {
                file.seek(SeekFrom::Current(i64::try_from(size).ok()?))
                    .ok()?;
            }
            (_, None) => break,
        }
        if saw_info && saw_tracks {
            break;
        }
    }
    (saw_info || saw_tracks).then_some(info)
}

fn read_body(file: &mut impl Read, size: u64) -> Option<Vec<u8>> {
    let mut body = vec![0u8; usize::try_from(size).ok()?];
    file.read_exact(&mut body).ok()?;
    Some(body)
}

/// An element's id with its length marker, and its size, or `None` for "unknown size".
fn element_header(file: &mut impl Read) -> Option<(u32, ElementSize)> {
    let mut first = [0u8; 1];
    file.read_exact(&mut first).ok()?;
    let id_len = first[0].leading_zeros() as usize + 1;
    if id_len > 4 {
        return None;
    }
    let mut id = u32::from(first[0]);
    for _ in 1..id_len {
        file.read_exact(&mut first).ok()?;
        id = (id << 8) | u32::from(first[0]);
    }
    Some((id, read_size(file)?))
}

/// `None` is a real value here: an element of unknown size, as a live-written file has.
type ElementSize = Option<u64>;

fn read_size(file: &mut impl Read) -> Option<ElementSize> {
    let mut byte = [0u8; 1];
    file.read_exact(&mut byte).ok()?;
    let length = byte[0].leading_zeros() as usize + 1;
    if length > 8 {
        return None;
    }
    let mut value = u64::from(byte[0]) & ((1u64 << (8 - length)) - 1);
    let mut all_ones = value == (1u64 << (8 - length)) - 1;
    for _ in 1..length {
        file.read_exact(&mut byte).ok()?;
        all_ones &= byte[0] == 0xFF;
        value = (value << 8) | u64::from(byte[0]);
    }
    Some((!all_ones).then_some(value))
}

/// The direct child elements of an element's body; a malformed length ends the walk.
fn children(body: &[u8]) -> Vec<(u32, &[u8])> {
    let mut out = Vec::new();
    let mut cursor = std::io::Cursor::new(body);
    while let Some((id, Some(size))) = element_header(&mut cursor) {
        let start = usize::try_from(cursor.position()).unwrap_or(usize::MAX);
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|size| start.checked_add(size))
        else {
            break;
        };
        let Some(value) = body.get(start..end) else {
            break;
        };
        out.push((id, value));
        cursor.set_position(end as u64);
    }
    out
}

fn as_uint(value: &[u8]) -> u64 {
    value
        .iter()
        .take(8)
        .fold(0u64, |acc, byte| (acc << 8) | u64::from(*byte))
}

fn as_float(value: &[u8]) -> Option<f64> {
    match value.len() {
        4 => Some(f64::from(f32::from_be_bytes(value.try_into().ok()?))),
        8 => Some(f64::from_be_bytes(value.try_into().ok()?)),
        _ => None,
    }
}

fn parse_info(body: &[u8], info: &mut ContainerInfo) {
    let mut scale = DEFAULT_TIMECODE_SCALE;
    let mut ticks = None;
    for (id, value) in children(body) {
        match id {
            TIMECODE_SCALE => scale = as_uint(value),
            DURATION => ticks = as_float(value),
            TITLE => {
                let title = String::from_utf8_lossy(value).trim().to_string();
                info.title = (!title.is_empty()).then_some(title);
            }
            _ => {}
        }
    }
    if let Some(ticks) = ticks.filter(|ticks| ticks.is_finite() && *ticks > 0.0) {
        info.duration_ms = ticks_to_ms(ticks, scale);
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // Floats have no `TryFrom`, and `as` saturates, as wanted.
fn ticks_to_ms(ticks: f64, scale: u64) -> u64 {
    (ticks * scale as f64 / 1_000_000.0) as u64
}

fn parse_tracks(body: &[u8], info: &mut ContainerInfo) {
    for (id, entry) in children(body) {
        if id == TRACK_ENTRY {
            parse_track(entry, info);
        }
    }
}

fn parse_track(entry: &[u8], info: &mut ContainerInfo) {
    let (mut track_type, mut codec, mut frame_ns, mut video) = (0, "", 0, None);
    for (id, value) in children(entry) {
        match id {
            TRACK_TYPE => track_type = as_uint(value),
            CODEC_ID => codec = std::str::from_utf8(value).unwrap_or_default(),
            DEFAULT_DURATION => frame_ns = as_uint(value),
            VIDEO => video = Some(value),
            _ => {}
        }
    }
    let codec = codec.trim_end_matches('\0');
    match track_type {
        1 if info.video_codec.is_none() => {
            info.video_codec = Some(video_codec_name(codec));
            if let Some(video) = video {
                for (id, value) in children(video) {
                    match id {
                        PIXEL_WIDTH => info.width = u32::try_from(as_uint(value)).unwrap_or(0),
                        PIXEL_HEIGHT => info.height = u32::try_from(as_uint(value)).unwrap_or(0),
                        _ => {}
                    }
                }
            }
            if frame_ns > 0 {
                info.frame_rate = Some(1_000_000_000.0 / frame_ns as f64);
            }
        }
        2 => info.audio_codecs.push(audio_codec_name(codec)),
        _ => {}
    }
}

fn video_codec_name(id: &str) -> String {
    match id {
        "V_MPEG4/ISO/AVC" => "h264".into(),
        "V_MPEGH/ISO/HEVC" => "hevc".into(),
        "V_AV1" => "av1".into(),
        "V_VP9" => "vp9".into(),
        "V_VP8" => "vp8".into(),
        "V_MPEG2" => "mpeg2".into(),
        "V_MPEG4/ISO/ASP" | "V_MPEG4/ISO/SP" | "V_MPEG4/ISO/AP" => "mpeg4".into(),
        other => other.trim_start_matches("V_").to_lowercase(),
    }
}

fn audio_codec_name(id: &str) -> String {
    match id {
        "A_OPUS" => "opus".into(),
        "A_VORBIS" => "vorbis".into(),
        "A_FLAC" => "flac".into(),
        "A_ALAC" => "alac".into(),
        "A_MPEG/L3" => "mp3".into(),
        "A_AC3" => "ac3".into(),
        "A_EAC3" => "eac3".into(),
        "A_TRUEHD" => "truehd".into(),
        other if other.starts_with("A_AAC") => "aac".into(),
        other if other.starts_with("A_DTS") => "dts".into(),
        other if other.starts_with("A_PCM") => "pcm".into(),
        other => other.trim_start_matches("A_").to_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const CLUSTER: u32 = 0x1F43_B675;

    fn id_bytes(id: u32) -> Vec<u8> {
        id.to_be_bytes()
            .iter()
            .copied()
            .skip_while(|b| *b == 0)
            .collect()
    }

    fn element(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out = id_bytes(id);
        out.push(0x01);
        out.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        out.extend_from_slice(body);
        out
    }

    fn sample_file() -> Vec<u8> {
        let mut info = element(TIMECODE_SCALE, &1_000_000u32.to_be_bytes()[1..]);
        info.extend(element(DURATION, &90_500f64.to_be_bytes()));
        info.extend(element(TITLE, b"A film"));

        let mut video = element(PIXEL_WIDTH, &1280u16.to_be_bytes());
        video.extend(element(PIXEL_HEIGHT, &720u16.to_be_bytes()));
        let mut video_track = element(TRACK_TYPE, &[1]);
        video_track.extend(element(CODEC_ID, b"V_VP9"));
        video_track.extend(element(DEFAULT_DURATION, &40_000_000u32.to_be_bytes()));
        video_track.extend(element(VIDEO, &video));
        let mut audio_track = element(TRACK_TYPE, &[2]);
        audio_track.extend(element(CODEC_ID, b"A_DTS"));
        let mut tracks = element(TRACK_ENTRY, &video_track);
        tracks.extend(element(TRACK_ENTRY, &audio_track));

        let mut segment = element(0xEC, &[0u8; 32]);
        segment.extend(element(INFO, &info));
        segment.extend(element(TRACKS, &tracks));
        segment.extend(element(CLUSTER, &[0u8; 16]));

        let mut file = element(EBML_HEADER, &[0u8; 4]);
        file.extend(element(SEGMENT, &segment));
        file
    }

    #[test]
    fn reads_length_title_size_and_codecs() {
        let info = read_from(&mut Cursor::new(sample_file())).unwrap();
        assert_eq!(info.duration_ms, 90_500);
        assert_eq!(info.title.as_deref(), Some("A film"));
        assert_eq!((info.width, info.height), (1280, 720));
        assert_eq!(info.video_codec.as_deref(), Some("vp9"));
        assert_eq!(info.audio_codecs, vec!["dts".to_string()]);
        assert_eq!(info.frame_rate, Some(25.0));
    }

    #[test]
    fn another_format_and_broken_lengths_read_as_nothing() {
        assert_eq!(
            read_from(&mut Cursor::new(b"RIFF\x00\x00\x00\x00AVI ".to_vec())),
            None
        );
        let mut truncated = sample_file();
        truncated.truncate(30);
        assert!(read_from(&mut Cursor::new(truncated)).is_none());
        assert_eq!(children(&[0xFF, 0xFF, 0xFF]), Vec::new());
    }
}
