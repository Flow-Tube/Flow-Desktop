//! The last check before a download is marked done: the output holds the tracks it
//! should, its media bytes add up, and its length matches the source's.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Allowed length difference: 5 seconds or 5%, whichever is larger (Android's rule).
const MIN_TOLERANCE_SECONDS: f64 = 5.0;
const TOLERANCE_FRACTION: f64 = 0.05;
const MAX_MOOV_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Default)]
pub(super) struct TrackInspection {
    pub handler: [u8; 4],
    pub sample_count: u32,
    pub first_chunk_offset: u64,
    pub sample_bytes: u64,
}

#[derive(Debug, Default)]
pub(super) struct Mp4Inspection {
    pub top_level: Vec<[u8; 4]>,
    pub tracks: Vec<TrackInspection>,
    pub mdat_payload: u64,
    /// Where the first `mdat`'s payload starts.
    pub mdat_start: Option<u64>,
    pub duration_seconds: f64,
}

/// What a finished file must contain.
#[derive(Clone, Copy, Debug)]
pub struct OutputExpectation {
    pub video: bool,
    pub audio: bool,
    pub duration_seconds: Option<f64>,
}

/// Checks a Matroska file's tracks and the length its `Info` declares.
pub fn validate_matroska(path: &Path, expected: OutputExpectation) -> Result<(), String> {
    use webm_iterable::WebmIterator;
    use webm_iterable::matroska_spec::{Master, MatroskaSpec};

    let file =
        File::open(path).map_err(|error| format!("Could not reopen the finished file: {error}"))?;
    let mut duration_ms: Option<f64> = None;
    let mut timestamp_scale = 1_000_000_u64;
    let (mut video, mut audio) = (false, false);
    for tag in WebmIterator::new(
        file,
        &[
            MatroskaSpec::Info(Master::Start),
            MatroskaSpec::TrackEntry(Master::Start),
        ],
    ) {
        let tag = tag.map_err(|error| format!("The finished file is damaged: {error}"))?;
        match tag {
            MatroskaSpec::Info(Master::Full(children)) => {
                for child in children {
                    match child {
                        MatroskaSpec::Duration(value) => duration_ms = Some(value),
                        MatroskaSpec::TimestampScale(value) => timestamp_scale = value.max(1),
                        _ => {}
                    }
                }
            }
            MatroskaSpec::TrackEntry(Master::Full(children)) => {
                for child in children {
                    if let MatroskaSpec::TrackType(kind) = child {
                        video |= kind == 1;
                        audio |= kind == 2;
                    }
                }
            }
            MatroskaSpec::Cluster(_) => break,
            _ => {}
        }
    }
    if expected.video && !video {
        return Err("The finished file has no video track".into());
    }
    if expected.audio && !audio {
        return Err("The finished file has no audio track".into());
    }
    let ticks = duration_ms.ok_or("The finished file does not state its length")?;
    let scale = f64::from(u32::try_from(timestamp_scale).unwrap_or(u32::MAX));
    check_duration(ticks * scale / 1_000_000_000.0, expected.duration_seconds)
}

pub fn validate_mp4(path: &Path, expected: OutputExpectation) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("Could not reopen the finished file: {error}"))?;
    let inspection = inspect_mp4(&mut file)?;
    check_inspection(&inspection, expected)
}

#[cfg(test)]
pub(super) fn inspect_mp4_bytes(bytes: &[u8]) -> Result<Mp4Inspection, String> {
    inspect_mp4(&mut std::io::Cursor::new(bytes))
}

fn check_inspection(inspection: &Mp4Inspection, expected: OutputExpectation) -> Result<(), String> {
    let has = |handler: &[u8; 4]| {
        inspection
            .tracks
            .iter()
            .any(|track| &track.handler == handler && track.sample_count > 0)
    };
    if expected.video && !has(b"vide") {
        return Err("The finished file has no video track".into());
    }
    if expected.audio && !has(b"soun") {
        return Err("The finished file has no audio track".into());
    }
    let media_start = inspection
        .mdat_start
        .ok_or("The finished file has no media data")?;
    if inspection
        .tracks
        .iter()
        .any(|track| track.first_chunk_offset < media_start)
    {
        return Err("The finished file's index points outside its media data".into());
    }
    let sample_bytes: u64 = inspection
        .tracks
        .iter()
        .map(|track| track.sample_bytes)
        .sum();
    if sample_bytes != inspection.mdat_payload {
        return Err(format!(
            "The finished file's media data is {} bytes, but its index lists {sample_bytes}",
            inspection.mdat_payload
        ));
    }
    check_duration(inspection.duration_seconds, expected.duration_seconds)
}

pub fn check_duration(actual: f64, expected: Option<f64>) -> Result<(), String> {
    let Some(expected) = expected.filter(|seconds| *seconds > 0.0) else {
        return Ok(());
    };
    let tolerance = MIN_TOLERANCE_SECONDS.max(expected * TOLERANCE_FRACTION);
    if (actual - expected).abs() > tolerance {
        return Err(format!(
            "The finished file is {actual:.0} s long, but the source is {expected:.0} s"
        ));
    }
    Ok(())
}

fn inspect_mp4<R: Read + Seek>(reader: &mut R) -> Result<Mp4Inspection, String> {
    let io = |error: std::io::Error| format!("Could not read the finished file: {error}");
    let len = reader.seek(SeekFrom::End(0)).map_err(io)?;
    let mut inspection = Mp4Inspection::default();
    let mut moov: Option<Vec<u8>> = None;
    let mut pos = 0_u64;
    while pos + 8 <= len {
        reader.seek(SeekFrom::Start(pos)).map_err(io)?;
        let mut header = [0_u8; 8];
        reader.read_exact(&mut header).map_err(io)?;
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let kind = [header[4], header[5], header[6], header[7]];
        let (header_len, total) = match size32 {
            1 => {
                let mut large = [0_u8; 8];
                reader.read_exact(&mut large).map_err(io)?;
                (16, u64::from_be_bytes(large))
            }
            0 => (8, len - pos),
            size => (8, u64::from(size)),
        };
        if total < header_len || pos + total > len {
            return Err("The finished file ends inside a box".into());
        }
        inspection.top_level.push(kind);
        match &kind {
            b"moov" => {
                if total > MAX_MOOV_BYTES {
                    return Err("The finished file's index is too large".into());
                }
                let length = usize::try_from(total - header_len)
                    .map_err(|_| "The finished file's index is too large".to_string())?;
                let mut payload = vec![0_u8; length];
                reader.read_exact(&mut payload).map_err(io)?;
                moov = Some(payload);
            }
            b"mdat" => {
                inspection.mdat_start.get_or_insert(pos + header_len);
                inspection.mdat_payload += total - header_len;
            }
            _ => {}
        }
        pos += total;
    }
    let moov = moov.ok_or("The finished file has no index (moov)")?;
    parse_moov(&moov, &mut inspection)?;
    Ok(inspection)
}

fn parse_moov(moov: &[u8], inspection: &mut Mp4Inspection) -> Result<(), String> {
    for (kind, payload) in boxes(moov) {
        if &kind != b"trak" {
            continue;
        }
        let mdia = child(payload, b"mdia").ok_or("A track has no mdia box")?;
        let handler = child(mdia, b"hdlr")
            .and_then(|hdlr| hdlr.get(8..12))
            .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
            .ok_or("A track has no handler")?;
        let mdhd = child(mdia, b"mdhd").ok_or("A track has no mdhd box")?;
        let (timescale, duration) = if mdhd.first() == Some(&1) {
            (be32(mdhd, 20)?, be64(mdhd, 24)?)
        } else {
            (be32(mdhd, 12)?, u64::from(be32(mdhd, 16)?))
        };
        if timescale > 0 {
            inspection.duration_seconds = inspection
                .duration_seconds
                .max(ticks_to_seconds(duration, timescale));
        }
        let stbl = child(mdia, b"minf")
            .and_then(|minf| child(minf, b"stbl"))
            .ok_or("A track has no sample table")?;
        let stsz = child(stbl, b"stsz").ok_or("A track has no sample sizes")?;
        let fixed = be32(stsz, 4)?;
        let sample_count = be32(stsz, 8)?;
        let sample_bytes = if fixed != 0 {
            u64::from(fixed) * u64::from(sample_count)
        } else {
            (0..usize::try_from(sample_count).unwrap_or(0))
                .map(|index| be32(stsz, 12 + index * 4).map(u64::from))
                .sum::<Result<u64, String>>()?
        };
        let first_chunk_offset = if let Some(stco) = child(stbl, b"stco") {
            u64::from(be32(stco, 8)?)
        } else if let Some(co64) = child(stbl, b"co64") {
            be64(co64, 8)?
        } else {
            return Err("A track has no chunk offsets".into());
        };
        inspection.tracks.push(TrackInspection {
            handler,
            sample_count,
            first_chunk_offset,
            sample_bytes,
        });
    }
    Ok(())
}

/// Seconds from a tick count without the precision loss of a direct `u64` cast.
pub fn ticks_to_seconds(ticks: u64, timescale: u32) -> f64 {
    let scale = u64::from(timescale.max(1));
    let whole = f64::from(u32::try_from(ticks / scale).unwrap_or(u32::MAX));
    let rest = f64::from(u32::try_from(ticks % scale).unwrap_or(0));
    whole + rest / f64::from(timescale.max(1))
}

fn boxes(data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    let mut pos = 0_usize;
    std::iter::from_fn(move || {
        let header = data.get(pos..pos + 8)?;
        let size = usize::try_from(u32::from_be_bytes([
            header[0], header[1], header[2], header[3],
        ]))
        .unwrap_or(0);
        let kind = [header[4], header[5], header[6], header[7]];
        if size < 8 || pos + size > data.len() {
            return None;
        }
        let payload = &data[pos + 8..pos + size];
        pos += size;
        Some((kind, payload))
    })
}

fn child<'a>(data: &'a [u8], want: &[u8]) -> Option<&'a [u8]> {
    boxes(data).find_map(|(kind, payload)| (kind == want).then_some(payload))
}

fn be32(data: &[u8], offset: usize) -> Result<u32, String> {
    data.get(offset..offset + 4)
        .map(|bytes| u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .ok_or_else(|| "The finished file's index is truncated".to_string())
}

fn be64(data: &[u8], offset: usize) -> Result<u64, String> {
    data.get(offset..offset + 8)
        .and_then(|bytes| <[u8; 8]>::try_from(bytes).ok())
        .map(u64::from_be_bytes)
        .ok_or_else(|| "The finished file's index is truncated".to_string())
}

#[cfg(test)]
mod tests {
    use super::{OutputExpectation, check_duration, check_inspection, inspect_mp4_bytes};
    use crate::commands::downloads::muxer::mp4_writer::tests::{
        audio_track, options, samples, video_track,
    };
    use crate::commands::downloads::muxer::mp4_writer::write_mp4;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn duration_tolerance_is_five_seconds_or_five_percent() {
        assert!(check_duration(100.0, Some(104.0)).is_ok());
        assert!(check_duration(100.0, Some(106.0)).is_err());
        assert!(check_duration(3_000.0, Some(3_140.0)).is_ok());
        assert!(check_duration(3_000.0, Some(3_200.0)).is_err());
        assert!(check_duration(1.0, None).is_ok());
    }

    #[test]
    fn rejects_a_file_missing_its_audio() {
        let path = crate::commands::downloads::muxer::scratch_file("validate-video-only", "mp4");
        write_mp4(
            &path,
            vec![video_track(samples(30, 10, 3000, 30))],
            &options(),
            &AtomicBool::new(false),
        )
        .expect("writes");
        let inspection = inspect_mp4_bytes(&std::fs::read(&path).expect("reads")).expect("parses");
        let expectation = OutputExpectation {
            video: true,
            audio: true,
            duration_seconds: None,
        };
        assert!(check_inspection(&inspection, expectation).is_err());
    }

    #[test]
    fn accepts_a_complete_file() {
        let path = crate::commands::downloads::muxer::scratch_file("validate-complete", "mp4");
        write_mp4(
            &path,
            vec![
                video_track(samples(300, 10, 3000, 30)),
                audio_track(samples(431, 4, 1024, 1)),
            ],
            &options(),
            &AtomicBool::new(false),
        )
        .expect("writes");
        let expectation = OutputExpectation {
            video: true,
            audio: true,
            duration_seconds: Some(10.0),
        };
        super::validate_mp4(&path, expectation).expect("valid");
        let short = OutputExpectation {
            duration_seconds: Some(60.0),
            ..expectation
        };
        assert!(super::validate_mp4(&path, short).is_err());
    }
}
