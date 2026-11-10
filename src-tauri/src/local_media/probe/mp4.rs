//! Reads `moov` of an MP4 or `QuickTime` file: length, picture size and each track's codec.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::ContainerInfo;

/// A `moov` larger than this isn't worth holding in memory just to list the file.
const MAX_MOOV_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES: usize = 4096;

pub fn read(path: &Path) -> Option<ContainerInfo> {
    let mut file = File::open(path).ok()?;
    let moov = read_moov(&mut file)?;
    Some(parse_moov(&moov))
}

fn read_moov(file: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    let total = file.seek(SeekFrom::End(0)).ok()?;
    let mut offset = 0u64;
    for _ in 0..MAX_TOP_LEVEL_BOXES {
        if offset + 8 > total {
            return None;
        }
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header).ok()?;
        let short_size = u64::from(u32::from_be_bytes(header[..4].try_into().ok()?));
        let (size, header_len) = match short_size {
            0 => (total - offset, 8),
            1 => {
                let mut large = [0u8; 8];
                file.read_exact(&mut large).ok()?;
                (u64::from_be_bytes(large), 16)
            }
            size => (size, 8),
        };
        if size < header_len {
            return None;
        }
        if &header[4..8] == b"moov" {
            let body = size - header_len;
            if body > MAX_MOOV_BYTES {
                return None;
            }
            let mut moov = vec![0u8; usize::try_from(body).ok()?];
            file.read_exact(&mut moov).ok()?;
            return Some(moov);
        }
        offset = offset.checked_add(size)?;
    }
    None
}

/// The direct child boxes of a box's payload; a malformed length ends the walk.
fn children(payload: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut rest = payload;
    std::iter::from_fn(move || {
        let header = rest.get(..8)?;
        let size = u32::from_be_bytes(header[..4].try_into().ok()?) as usize;
        if size < 8 || size > rest.len() {
            return None;
        }
        let (current, next) = rest.split_at(size);
        rest = next;
        Some((&current[4..8], &current[8..]))
    })
}

fn child(payload: &[u8], name: [u8; 4]) -> Option<&[u8]> {
    children(payload)
        .find(|(kind, _)| *kind == name)
        .map(|(_, body)| body)
}

fn be_u32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

fn be_u64(data: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(data.get(at..at + 8)?.try_into().ok()?))
}

/// Timescale and duration of an `mvhd` or `mdhd`, which share this layout.
fn scale_and_duration(header: &[u8]) -> Option<(u32, u64)> {
    if *header.first()? == 1 {
        Some((be_u32(header, 20)?, be_u64(header, 24)?))
    } else {
        Some((be_u32(header, 12)?, u64::from(be_u32(header, 16)?)))
    }
}

/// Picture size from `tkhd`, swapped when its matrix turns the picture a quarter, as a phone's
/// portrait video does.
fn track_size(tkhd: &[u8]) -> Option<(u32, u32)> {
    let matrix_at = if *tkhd.first()? == 1 { 52 } else { 40 };
    let width = be_u32(tkhd, matrix_at + 36)? >> 16;
    let height = be_u32(tkhd, matrix_at + 40)? >> 16;
    let turned = be_u32(tkhd, matrix_at)? == 0 && be_u32(tkhd, matrix_at + 4)? != 0;
    Some(if turned {
        (height, width)
    } else {
        (width, height)
    })
}

fn sample_entries(stsd: &[u8]) -> Vec<[u8; 4]> {
    let body = stsd.get(8..).unwrap_or_default();
    children(body)
        .filter_map(|(kind, _)| <[u8; 4]>::try_from(kind).ok())
        .collect()
}

/// Frames per second from the sample table, across all of `stts` so variable rates average out.
fn frame_rate(stts: &[u8], timescale: u32) -> Option<f64> {
    let entries = be_u32(stts, 4)? as usize;
    let (mut samples, mut ticks) = (0u64, 0u64);
    for index in 0..entries.min(4096) {
        let count = u64::from(be_u32(stts, 8 + index * 8)?);
        let delta = u64::from(be_u32(stts, 12 + index * 8)?);
        samples += count;
        ticks += count * delta;
    }
    (ticks > 0 && timescale > 0).then(|| samples as f64 * f64::from(timescale) / ticks as f64)
}

fn video_codec_name(fourcc: [u8; 4]) -> String {
    match &fourcc {
        b"avc1" | b"avc3" => "h264".into(),
        b"hvc1" | b"hev1" | b"dvh1" | b"dvhe" => "hevc".into(),
        b"av01" => "av1".into(),
        b"vp09" => "vp9".into(),
        b"vp08" => "vp8".into(),
        b"mp4v" => "mpeg4".into(),
        b"apch" | b"apcn" | b"apcs" | b"apco" | b"ap4h" | b"ap4x" => "prores".into(),
        other => String::from_utf8_lossy(other).trim().to_lowercase(),
    }
}

fn audio_codec_name(fourcc: [u8; 4]) -> String {
    match &fourcc {
        b"mp4a" => "aac".into(),
        b"ac-3" => "ac3".into(),
        b"ec-3" => "eac3".into(),
        b"Opus" => "opus".into(),
        b"fLaC" => "flac".into(),
        b"alac" => "alac".into(),
        b"dtsc" | b"dtse" | b"dtsh" | b"dtsl" => "dts".into(),
        b"mlpa" => "truehd".into(),
        b"lpcm" | b"sowt" | b"twos" | b"ipcm" | b"in24" | b"fl32" => "pcm".into(),
        other => String::from_utf8_lossy(other).trim().to_lowercase(),
    }
}

fn parse_moov(moov: &[u8]) -> ContainerInfo {
    let mut info = ContainerInfo::default();
    if let Some((scale, duration)) = child(moov, *b"mvhd").and_then(scale_and_duration)
        && scale > 0
    {
        info.duration_ms = duration.saturating_mul(1000) / u64::from(scale);
    }
    for (kind, trak) in children(moov) {
        if kind != b"trak" {
            continue;
        }
        let Some(mdia) = child(trak, *b"mdia") else {
            continue;
        };
        let Some(handler) = child(mdia, *b"hdlr").and_then(|hdlr| hdlr.get(8..12)) else {
            continue;
        };
        let stbl = child(mdia, *b"minf").and_then(|minf| child(minf, *b"stbl"));
        let entries = stbl
            .and_then(|stbl| child(stbl, *b"stsd"))
            .map(sample_entries)
            .unwrap_or_default();
        match handler {
            b"vide" if info.video_codec.is_none() => {
                info.video_codec = entries.first().copied().map(video_codec_name);
                if let Some((width, height)) = child(trak, *b"tkhd").and_then(track_size) {
                    info.width = width;
                    info.height = height;
                }
                let timescale = child(mdia, *b"mdhd")
                    .and_then(scale_and_duration)
                    .map(|(scale, _)| scale);
                info.frame_rate = stbl
                    .and_then(|stbl| child(stbl, *b"stts"))
                    .zip(timescale)
                    .and_then(|(stts, scale)| frame_rate(stts, scale));
            }
            b"soun" => info
                .audio_codecs
                .extend(entries.iter().copied().map(audio_codec_name)),
            _ => {}
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn boxed(kind: [u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = u32::try_from(body.len() + 8)
            .unwrap()
            .to_be_bytes()
            .to_vec();
        out.extend_from_slice(&kind);
        out.extend_from_slice(body);
        out
    }

    fn mvhd(scale: u32, duration: u32) -> Vec<u8> {
        let mut body = vec![0u8; 12];
        body.extend_from_slice(&scale.to_be_bytes());
        body.extend_from_slice(&duration.to_be_bytes());
        boxed(*b"mvhd", &body)
    }

    fn tkhd(width: u32, height: u32, turned: bool) -> Vec<u8> {
        let mut body = vec![0u8; 40];
        let (a, b): (u32, u32) = if turned {
            (0u32, 0x0001_0000)
        } else {
            (0x0001_0000, 0)
        };
        body.extend_from_slice(&a.to_be_bytes());
        body.extend_from_slice(&b.to_be_bytes());
        body.extend_from_slice(&[0u8; 28]);
        body.extend_from_slice(&(width << 16).to_be_bytes());
        body.extend_from_slice(&(height << 16).to_be_bytes());
        boxed(*b"tkhd", &body)
    }

    fn track(
        handler: [u8; 4],
        entry: [u8; 4],
        header: Option<Vec<u8>>,
        stts: Option<Vec<u8>>,
    ) -> Vec<u8> {
        let mut hdlr = vec![0u8; 8];
        hdlr.extend_from_slice(&handler);
        let mut mdhd = vec![0u8; 12];
        mdhd.extend_from_slice(&30_000u32.to_be_bytes());
        mdhd.extend_from_slice(&[0u8; 4]);
        let mut stsd = vec![0u8; 8];
        stsd.extend_from_slice(&boxed(entry, &[0u8; 8]));
        let mut stbl = boxed(*b"stsd", &stsd);
        if let Some(stts) = stts {
            stbl.extend_from_slice(&boxed(*b"stts", &stts));
        }
        let minf = boxed(*b"minf", &boxed(*b"stbl", &stbl));
        let mut mdia = boxed(*b"hdlr", &hdlr);
        mdia.extend_from_slice(&boxed(*b"mdhd", &mdhd));
        mdia.extend_from_slice(&minf);
        let mut trak = header.unwrap_or_default();
        trak.extend_from_slice(&boxed(*b"mdia", &mdia));
        boxed(*b"trak", &trak)
    }

    fn sample_moov(turned: bool) -> Vec<u8> {
        let mut stts = vec![0u8; 4];
        stts.extend_from_slice(&1u32.to_be_bytes());
        stts.extend_from_slice(&300u32.to_be_bytes());
        stts.extend_from_slice(&1001u32.to_be_bytes());
        let mut moov = mvhd(1000, 90_500);
        moov.extend_from_slice(&track(
            *b"vide",
            *b"avc1",
            Some(tkhd(1920, 1080, turned)),
            Some(stts),
        ));
        moov.extend_from_slice(&track(*b"soun", *b"ac-3", None, None));
        moov
    }

    #[test]
    fn reads_length_size_and_codecs_with_moov_after_the_media() {
        let mut file = boxed(*b"ftyp", b"isom");
        file.extend_from_slice(&boxed(*b"mdat", &[0u8; 4000]));
        file.extend_from_slice(&boxed(*b"moov", &sample_moov(false)));
        let moov = read_moov(&mut Cursor::new(file)).unwrap();
        let info = parse_moov(&moov);
        assert_eq!(info.duration_ms, 90_500);
        assert_eq!((info.width, info.height), (1920, 1080));
        assert_eq!(info.video_codec.as_deref(), Some("h264"));
        assert_eq!(info.audio_codecs, vec!["ac3".to_string()]);
        let rate = info.frame_rate.unwrap();
        assert!((rate - 29.97).abs() < 0.01, "{rate}");
    }

    #[test]
    fn a_quarter_turned_track_counts_as_portrait() {
        let info = parse_moov(&sample_moov(true));
        assert_eq!((info.width, info.height), (1080, 1920));
    }

    #[test]
    fn broken_lengths_end_the_walk_without_panicking() {
        assert_eq!(
            read_moov(&mut Cursor::new(vec![0, 0, 0, 2, b'x', b'x', b'x', b'x'])),
            None
        );
        let bad = [0u8, 0, 0, 200, b't', b'r', b'a', b'k', 1, 2, 3];
        assert_eq!(parse_moov(&bad), ContainerInfo::default());
        assert_eq!(read_moov(&mut Cursor::new(Vec::new())), None);
    }
}
