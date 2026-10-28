//! Progressive MP4 writer: `ftyp`, `moov`, a `free` pad, then one `mdat`.
//!
//! Every sample's size and timing is known before any media is written, so the
//! sample tables are built first and `moov` lands ahead of `mdat`: playback starts
//! without reading to the end of the file, and tags live in `moov/udta` from the
//! start. The pad after `moov` leaves room to retag later without moving `mdat`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::boxes::{Payload, container, full_box, mp4_box};

/// Movie timescale used for `mvhd`, `tkhd` and edit-list durations.
const MOVIE_TIMESCALE: u32 = 1_000;
const CHUNK_SECONDS: u64 = 1;
const WRITE_BUFFER_BYTES: usize = 1024 * 1024;
const IDENTITY_MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct WriterSample {
    pub size: u32,
    pub duration: u32,
    pub composition_offset: i32,
    pub is_sync: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TrackRole {
    Video { width: u16, height: u16 },
    Audio,
}

/// Hands out sample bytes in the order the writer asks for them, which is
/// always increasing within one track.
pub(super) trait SampleSource {
    fn read_sample(&mut self, index: usize, sample: &WriterSample) -> Result<Vec<u8>, String>;
}

pub(super) struct WriterTrack<'a> {
    pub role: TrackRole,
    pub timescale: u32,
    /// The complete `stsd` entry box (`avc1`, `vp09`, `mp4a`, …).
    pub sample_entry: Vec<u8>,
    pub samples: Vec<WriterSample>,
    /// Where presentation starts in track ticks; written as an edit list when positive.
    pub media_time: Option<i64>,
    pub source: Box<dyn SampleSource + 'a>,
}

pub(super) struct Mp4Options {
    pub major_brand: [u8; 4],
    pub compatible_brands: Vec<[u8; 4]>,
    /// The movie-level `udta` box (tags, chapters).
    pub udta: Option<Vec<u8>>,
    /// Bytes reserved after `moov` for retagging in place.
    pub padding: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Chunk {
    track: usize,
    first: usize,
    count: usize,
}

pub(super) fn write_mp4(
    path: &Path,
    mut tracks: Vec<WriterTrack<'_>>,
    options: &Mp4Options,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    if tracks.is_empty() || tracks.iter().any(|track| track.samples.is_empty()) {
        return Err("The MP4 writer needs at least one sample in every track".into());
    }
    if tracks.iter().any(|track| track.timescale == 0) {
        return Err("The MP4 writer was given a track with no timescale".into());
    }
    let chunks = plan_chunks(&tracks);
    let payload_bytes: u64 = tracks
        .iter()
        .flat_map(|track| track.samples.iter())
        .map(|sample| u64::from(sample.size))
        .sum();
    // Offsets past 4 GiB need 64-bit chunk offsets; the margin covers moov itself.
    let wide_offsets = payload_bytes + 64 * 1024 * 1024 > u64::from(u32::MAX);
    let large_mdat = payload_bytes + 8 > u64::from(u32::MAX);

    let ftyp = ftyp_box(options);
    let pad = if options.padding >= 8 {
        mp4_box(
            b"free",
            &vec![0; usize::try_from(options.padding - 8).unwrap_or(0)],
        )
    } else {
        Vec::new()
    };
    let mdat_header_len: u64 = if large_mdat { 16 } else { 8 };
    let probe = moov_box(&tracks, &chunks, options, 0, wide_offsets);
    let data_start = (ftyp.len() + probe.len() + pad.len()) as u64 + mdat_header_len;
    let moov = moov_box(&tracks, &chunks, options, data_start, wide_offsets);
    debug_assert_eq!(probe.len(), moov.len());

    let file =
        File::create(path).map_err(|error| format!("Could not create MP4 output: {error}"))?;
    let mut out = BufWriter::with_capacity(WRITE_BUFFER_BYTES, file);
    let io = |error: std::io::Error| format!("Could not write MP4 output: {error}");
    out.write_all(&ftyp).map_err(io)?;
    out.write_all(&moov).map_err(io)?;
    out.write_all(&pad).map_err(io)?;
    if large_mdat {
        out.write_all(&1_u32.to_be_bytes()).map_err(io)?;
        out.write_all(b"mdat").map_err(io)?;
        out.write_all(&(payload_bytes + 16).to_be_bytes())
            .map_err(io)?;
    } else {
        let size = u32::try_from(payload_bytes + 8).expect("checked against u32::MAX");
        out.write_all(&size.to_be_bytes()).map_err(io)?;
        out.write_all(b"mdat").map_err(io)?;
    }

    for chunk in &chunks {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        let track = &mut tracks[chunk.track];
        for index in chunk.first..chunk.first + chunk.count {
            let sample = track.samples[index];
            let data = track.source.read_sample(index, &sample)?;
            if data.len() != sample.size as usize {
                return Err(format!(
                    "Sample {index} changed size while muxing ({} bytes, expected {})",
                    data.len(),
                    sample.size
                ));
            }
            out.write_all(&data).map_err(io)?;
        }
    }
    out.flush().map_err(io)?;
    out.into_inner()
        .map_err(|error| format!("Could not flush MP4 output: {error}"))?
        .sync_all()
        .map_err(io)
}

/// Interleaves tracks in roughly one-second chunks, always continuing with the
/// track whose decode clock is furthest behind.
fn plan_chunks(tracks: &[WriterTrack<'_>]) -> Vec<Chunk> {
    let mut next = vec![0_usize; tracks.len()];
    let mut clock = vec![0_u64; tracks.len()];
    let mut chunks = Vec::new();
    loop {
        let mut pick: Option<usize> = None;
        for (index, track) in tracks.iter().enumerate() {
            if next[index] >= track.samples.len() {
                continue;
            }
            pick = match pick {
                None => Some(index),
                Some(best) => {
                    let ours = u128::from(clock[index]) * u128::from(tracks[best].timescale);
                    let theirs = u128::from(clock[best]) * u128::from(track.timescale);
                    Some(if ours < theirs { index } else { best })
                }
            };
        }
        let Some(index) = pick else { break };
        let track = &tracks[index];
        let limit = u64::from(track.timescale) * CHUNK_SECONDS;
        let start = clock[index];
        let first = next[index];
        while next[index] < track.samples.len()
            && (next[index] == first || clock[index] - start < limit)
        {
            clock[index] += u64::from(track.samples[next[index]].duration);
            next[index] += 1;
        }
        chunks.push(Chunk {
            track: index,
            first,
            count: next[index] - first,
        });
    }
    chunks
}

fn ftyp_box(options: &Mp4Options) -> Vec<u8> {
    let mut payload = Payload::new();
    payload.bytes(&options.major_brand).u32(512);
    for brand in &options.compatible_brands {
        payload.bytes(brand);
    }
    mp4_box(b"ftyp", &payload.finish())
}

fn moov_box(
    tracks: &[WriterTrack<'_>],
    chunks: &[Chunk],
    options: &Mp4Options,
    data_start: u64,
    wide_offsets: bool,
) -> Vec<u8> {
    let offsets = chunk_offsets(tracks, chunks, data_start);
    let mut children = Vec::new();
    let movie_duration = tracks.iter().map(presented_duration).max().unwrap_or(0);
    children.push(mvhd_box(movie_duration, count(tracks.len()) + 1));
    for (index, track) in tracks.iter().enumerate() {
        let track_chunks: Vec<&Chunk> = chunks.iter().filter(|c| c.track == index).collect();
        children.push(trak_box(
            track,
            count(index) + 1,
            &track_chunks,
            &offsets[index],
            wide_offsets,
        ));
    }
    if let Some(udta) = &options.udta {
        children.push(udta.clone());
    }
    container(b"moov", &children)
}

/// Absolute file offset of each track's chunks, in chunk order.
fn chunk_offsets(tracks: &[WriterTrack<'_>], chunks: &[Chunk], data_start: u64) -> Vec<Vec<u64>> {
    let mut offsets = vec![Vec::new(); tracks.len()];
    let mut cursor = data_start;
    for chunk in chunks {
        offsets[chunk.track].push(cursor);
        cursor += tracks[chunk.track].samples[chunk.first..chunk.first + chunk.count]
            .iter()
            .map(|sample| u64::from(sample.size))
            .sum::<u64>();
    }
    offsets
}

fn media_duration(track: &WriterTrack<'_>) -> u64 {
    track
        .samples
        .iter()
        .map(|sample| u64::from(sample.duration))
        .sum()
}

fn edit_start(track: &WriterTrack<'_>) -> Option<u64> {
    track
        .media_time
        .and_then(|time| u64::try_from(time).ok())
        .filter(|time| *time > 0)
}

/// When the last frame stops showing, in track ticks. With B-frames this is past
/// the decode end by the final frame's composition offset.
fn presentation_end(track: &WriterTrack<'_>) -> u64 {
    let mut decode = 0_i64;
    let mut end = 0_i64;
    for sample in &track.samples {
        let duration = i64::from(sample.duration);
        end = end.max(decode + i64::from(sample.composition_offset) + duration);
        decode += duration;
    }
    u64::try_from(end).unwrap_or(0)
}

/// The track's presented length in movie ticks, after its edit list.
fn presented_duration(track: &WriterTrack<'_>) -> u64 {
    let ticks = presentation_end(track).saturating_sub(edit_start(track).unwrap_or(0));
    rescale(ticks, track.timescale, MOVIE_TIMESCALE)
}

fn rescale(value: u64, from: u32, to: u32) -> u64 {
    u64::try_from(u128::from(value) * u128::from(to) / u128::from(from.max(1))).unwrap_or(u64::MAX)
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// A 32-bit field; callers switch to the 64-bit box version before this saturates.
fn narrow(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn needs_v1(values: &[u64]) -> bool {
    values.iter().any(|value| *value > u64::from(u32::MAX))
}

fn mvhd_box(duration: u64, next_track_id: u32) -> Vec<u8> {
    let v1 = needs_v1(&[duration]);
    let mut payload = Payload::new();
    if v1 {
        payload.u64(0).u64(0).u32(MOVIE_TIMESCALE).u64(duration);
    } else {
        payload
            .u32(0)
            .u32(0)
            .u32(MOVIE_TIMESCALE)
            .u32(narrow(duration));
    }
    payload.u32(0x0001_0000).u16(0x0100).zeros(10);
    for value in IDENTITY_MATRIX {
        payload.u32(value);
    }
    payload.zeros(24).u32(next_track_id);
    full_box(b"mvhd", u8::from(v1), 0, &payload.finish())
}

fn trak_box(
    track: &WriterTrack<'_>,
    track_id: u32,
    chunks: &[&Chunk],
    offsets: &[u64],
    wide_offsets: bool,
) -> Vec<u8> {
    let mut children = vec![tkhd_box(track, track_id)];
    if let Some(start) = edit_start(track) {
        children.push(container(
            b"edts",
            &[elst_box(presented_duration(track), start)],
        ));
    }
    children.push(mdia_box(track, chunks, offsets, wide_offsets));
    container(b"trak", &children)
}

fn tkhd_box(track: &WriterTrack<'_>, track_id: u32) -> Vec<u8> {
    let duration = presented_duration(track);
    let v1 = needs_v1(&[duration]);
    let mut payload = Payload::new();
    if v1 {
        payload.u64(0).u64(0).u32(track_id).u32(0).u64(duration);
    } else {
        payload
            .u32(0)
            .u32(0)
            .u32(track_id)
            .u32(0)
            .u32(narrow(duration));
    }
    payload.zeros(8).u16(0).u16(0);
    payload.u16(if track.role == TrackRole::Audio {
        0x0100
    } else {
        0
    });
    payload.u16(0);
    for value in IDENTITY_MATRIX {
        payload.u32(value);
    }
    let (width, height) = match track.role {
        TrackRole::Video { width, height } => (width, height),
        TrackRole::Audio => (0, 0),
    };
    payload
        .u32(u32::from(width) << 16)
        .u32(u32::from(height) << 16);
    // Flags: enabled | in movie | in preview.
    full_box(b"tkhd", u8::from(v1), 0x7, &payload.finish())
}

fn elst_box(segment_duration: u64, media_time: u64) -> Vec<u8> {
    let v1 = needs_v1(&[segment_duration, media_time]);
    let mut payload = Payload::new();
    payload.u32(1);
    if v1 {
        payload
            .u64(segment_duration)
            .i64(i64::try_from(media_time).unwrap_or(i64::MAX));
    } else {
        payload
            .u32(narrow(segment_duration))
            .i32(i32::try_from(media_time).unwrap_or(i32::MAX));
    }
    payload.u16(1).u16(0);
    full_box(b"elst", u8::from(v1), 0, &payload.finish())
}

fn mdia_box(
    track: &WriterTrack<'_>,
    chunks: &[&Chunk],
    offsets: &[u64],
    wide_offsets: bool,
) -> Vec<u8> {
    let duration = media_duration(track);
    let v1 = needs_v1(&[duration]);
    let mut mdhd = Payload::new();
    if v1 {
        mdhd.u64(0).u64(0).u32(track.timescale).u64(duration);
    } else {
        mdhd.u32(0)
            .u32(0)
            .u32(track.timescale)
            .u32(narrow(duration));
    }
    // ISO-639-2 "und", packed as three 5-bit letters.
    mdhd.u16(0x55C4).u16(0);

    let (handler, name, media_header): (&[u8; 4], &[u8], Vec<u8>) = match track.role {
        TrackRole::Video { .. } => (b"vide", b"VideoHandler\0", full_box(b"vmhd", 0, 1, &[0; 8])),
        TrackRole::Audio => (b"soun", b"SoundHandler\0", full_box(b"smhd", 0, 0, &[0; 4])),
    };
    let mut hdlr = Payload::new();
    hdlr.u32(0).bytes(handler).zeros(12).bytes(name);

    let mut dref = Payload::new();
    dref.u32(1).bytes(&full_box(b"url ", 0, 1, &[]));
    let dref = full_box(b"dref", 0, 0, &dref.finish());
    let minf = container(
        b"minf",
        &[
            media_header,
            container(b"dinf", &[dref]),
            stbl_box(track, chunks, offsets, wide_offsets),
        ],
    );
    container(
        b"mdia",
        &[
            full_box(b"mdhd", u8::from(v1), 0, &mdhd.finish()),
            full_box(b"hdlr", 0, 0, &hdlr.finish()),
            minf,
        ],
    )
}

fn stbl_box(
    track: &WriterTrack<'_>,
    chunks: &[&Chunk],
    offsets: &[u64],
    wide_offsets: bool,
) -> Vec<u8> {
    let samples = &track.samples;
    let mut stsd = Payload::new();
    stsd.u32(1).bytes(&track.sample_entry);
    let mut children = vec![full_box(b"stsd", 0, 0, &stsd.finish()), stts_box(samples)];
    if samples.iter().any(|sample| sample.composition_offset != 0) {
        children.push(ctts_box(samples));
    }
    if matches!(track.role, TrackRole::Video { .. }) && !samples.iter().all(|s| s.is_sync) {
        children.push(stss_box(samples));
    }
    children.push(stsc_box(chunks));
    children.push(stsz_box(samples));
    children.push(chunk_offset_box(offsets, wide_offsets));
    container(b"stbl", &children)
}

fn run_lengths<T: PartialEq + Copy>(values: impl Iterator<Item = T>) -> Vec<(u32, T)> {
    let mut runs: Vec<(u32, T)> = Vec::new();
    for value in values {
        match runs.last_mut() {
            Some((count, last)) if *last == value => *count += 1,
            _ => runs.push((1, value)),
        }
    }
    runs
}

fn stts_box(samples: &[WriterSample]) -> Vec<u8> {
    let runs = run_lengths(samples.iter().map(|sample| sample.duration));
    let mut payload = Payload::new();
    payload.u32(count(runs.len()));
    for (count, duration) in runs {
        payload.u32(count).u32(duration);
    }
    full_box(b"stts", 0, 0, &payload.finish())
}

fn ctts_box(samples: &[WriterSample]) -> Vec<u8> {
    let runs = run_lengths(samples.iter().map(|sample| sample.composition_offset));
    let signed = runs.iter().any(|(_, offset)| *offset < 0);
    let mut payload = Payload::new();
    payload.u32(count(runs.len()));
    for (count, offset) in runs {
        payload.u32(count).i32(offset);
    }
    full_box(b"ctts", u8::from(signed), 0, &payload.finish())
}

fn stss_box(samples: &[WriterSample]) -> Vec<u8> {
    let sync: Vec<u32> = samples
        .iter()
        .enumerate()
        .filter(|(_, sample)| sample.is_sync)
        .map(|(index, _)| count(index) + 1)
        .collect();
    let mut payload = Payload::new();
    payload.u32(count(sync.len()));
    for number in sync {
        payload.u32(number);
    }
    full_box(b"stss", 0, 0, &payload.finish())
}

fn stsc_box(chunks: &[&Chunk]) -> Vec<u8> {
    let mut entries: Vec<(u32, u32)> = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let per_chunk = count(chunk.count);
        if entries.last().is_none_or(|(_, last)| *last != per_chunk) {
            entries.push((count(index) + 1, per_chunk));
        }
    }
    let mut payload = Payload::new();
    payload.u32(count(entries.len()));
    for (first_chunk, count) in entries {
        payload.u32(first_chunk).u32(count).u32(1);
    }
    full_box(b"stsc", 0, 0, &payload.finish())
}

fn stsz_box(samples: &[WriterSample]) -> Vec<u8> {
    let mut payload = Payload::new();
    payload.u32(0).u32(count(samples.len()));
    for sample in samples {
        payload.u32(sample.size);
    }
    full_box(b"stsz", 0, 0, &payload.finish())
}

fn chunk_offset_box(offsets: &[u64], wide: bool) -> Vec<u8> {
    let mut payload = Payload::new();
    payload.u32(count(offsets.len()));
    if wide {
        for offset in offsets {
            payload.u64(*offset);
        }
        full_box(b"co64", 0, 0, &payload.finish())
    } else {
        for offset in offsets {
            payload.u32(u32::try_from(*offset).unwrap_or(u32::MAX));
        }
        full_box(b"stco", 0, 0, &payload.finish())
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::{
        Mp4Options, SampleSource, TrackRole, WriterSample, WriterTrack, plan_chunks, write_mp4,
    };
    use std::sync::atomic::AtomicBool;

    /// Each sample's bytes are its index repeated, so tests can check placement.
    pub(in crate::commands::downloads::muxer) struct PatternSource;

    impl SampleSource for PatternSource {
        fn read_sample(&mut self, index: usize, sample: &WriterSample) -> Result<Vec<u8>, String> {
            Ok(vec![
                u8::try_from(index % 251).unwrap_or(0);
                sample.size as usize
            ])
        }
    }

    pub(in crate::commands::downloads::muxer) fn samples(
        count: usize,
        size: u32,
        duration: u32,
        sync_every: usize,
    ) -> Vec<WriterSample> {
        (0..count)
            .map(|index| WriterSample {
                size,
                duration,
                composition_offset: 0,
                is_sync: index % sync_every == 0,
            })
            .collect()
    }

    pub(in crate::commands::downloads::muxer) fn video_track(
        samples: Vec<WriterSample>,
    ) -> WriterTrack<'static> {
        WriterTrack {
            role: TrackRole::Video {
                width: 640,
                height: 360,
            },
            timescale: 90_000,
            sample_entry: super::super::boxes::mp4_box(b"avc1", &[0; 78]),
            samples,
            media_time: None,
            source: Box::new(PatternSource),
        }
    }

    pub(in crate::commands::downloads::muxer) fn audio_track(
        samples: Vec<WriterSample>,
    ) -> WriterTrack<'static> {
        WriterTrack {
            role: TrackRole::Audio,
            timescale: 44_100,
            sample_entry: super::super::boxes::mp4_box(b"mp4a", &[0; 28]),
            samples,
            media_time: Some(1024),
            source: Box::new(PatternSource),
        }
    }

    pub(in crate::commands::downloads::muxer) fn options() -> Mp4Options {
        Mp4Options {
            major_brand: *b"isom",
            compatible_brands: vec![*b"isom", *b"iso2", *b"mp41"],
            udta: None,
            padding: 4096,
        }
    }

    #[test]
    fn chunks_interleave_by_decode_time() {
        // 3 s of 30 fps video and 3 s of 1024-sample AAC frames.
        let tracks = vec![
            video_track(samples(90, 10, 3000, 30)),
            audio_track(samples(130, 4, 1024, 1)),
        ];
        let chunks = plan_chunks(&tracks);
        assert_eq!(
            chunks
                .iter()
                .filter(|c| c.track == 0)
                .map(|c| c.count)
                .sum::<usize>(),
            90
        );
        assert_eq!(
            chunks
                .iter()
                .filter(|c| c.track == 1)
                .map(|c| c.count)
                .sum::<usize>(),
            130
        );
        assert_eq!(chunks[0].track, 0);
        assert_eq!(chunks[1].track, 1);
        assert_eq!(chunks[0].count, 30);
    }

    #[test]
    fn writes_moov_before_mdat_with_correct_offsets() {
        let path = super::super::scratch_file("writer-order", "mp4");
        let tracks = vec![
            video_track(samples(60, 100, 3000, 30)),
            audio_track(samples(87, 20, 1024, 1)),
        ];
        write_mp4(&path, tracks, &options(), &AtomicBool::new(false)).expect("writes");
        let bytes = std::fs::read(&path).expect("reads");
        let parsed = super::super::validate::inspect_mp4_bytes(&bytes).expect("parses");
        assert_eq!(
            parsed.top_level,
            vec![*b"ftyp", *b"moov", *b"free", *b"mdat"]
        );
        assert_eq!(parsed.tracks.len(), 2);
        assert_eq!(parsed.tracks[0].handler, *b"vide");
        assert_eq!(parsed.tracks[0].sample_count, 60);
        assert_eq!(parsed.tracks[1].handler, *b"soun");
        assert_eq!(parsed.mdat_payload, 60 * 100 + 87 * 20);
        // The first chunk is video sample 0, so the first mdat byte is index 0.
        let first = usize::try_from(parsed.tracks[0].first_chunk_offset).expect("offset fits");
        assert_eq!(&bytes[first..first + 100], &[0_u8; 100]);
        let audio = usize::try_from(parsed.tracks[1].first_chunk_offset).expect("offset fits");
        assert_eq!(&bytes[audio..audio + 20], &[0_u8; 20]);
        assert!((parsed.duration_seconds - 2.0).abs() < 0.05);
    }

    #[test]
    fn writes_an_edit_list_for_a_positive_media_time() {
        let path = super::super::scratch_file("writer-elst", "m4a");
        write_mp4(
            &path,
            vec![audio_track(samples(50, 8, 1024, 1))],
            &options(),
            &AtomicBool::new(false),
        )
        .expect("writes");
        let bytes = std::fs::read(&path).expect("reads");
        let at = bytes
            .windows(4)
            .position(|window| window == b"elst")
            .expect("edit list present");
        // version 0, one entry, media_time 1024.
        assert_eq!(&bytes[at + 8..at + 12], &[0, 0, 0, 1]);
        assert_eq!(&bytes[at + 16..at + 20], &1024_i32.to_be_bytes());
    }
}
