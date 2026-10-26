//! Minimal fragmented-MP4 (ISO-BMFF / DASH) demuxer.
//!
//! `YouTube` delivers AV1, HEVC and H.264 video as fragmented MP4 (`moof`/`trun`/`mdat`
//! with empty sample tables in `moov`), not `WebM`. This reads such a stream into
//! per-sample byte ranges plus the codec configuration, exposing each sample as a
//! [`MatroskaPacket`] so the Matroska writer can interleave it next to a `WebM` audio
//! track without an external demuxer.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use webm_iterable::matroska_spec::{Master, MatroskaSpec};

use super::{MatroskaPacket, TrackKind};

const NS_PER_SEC: i128 = 1_000_000_000;
/// `sample_is_non_sync_sample` bit of an ISO-BMFF sample-flags word.
const NON_SYNC_FLAG: u32 = 0x0001_0000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Codec {
    Av1,
    H264,
    Hevc,
    Vp9,
    Vp8,
    Aac,
}

impl Codec {
    fn from_fourcc(fourcc: [u8; 4]) -> Option<Self> {
        match &fourcc {
            b"av01" => Some(Self::Av1),
            b"avc1" | b"avc3" => Some(Self::H264),
            b"hvc1" | b"hev1" => Some(Self::Hevc),
            b"vp09" => Some(Self::Vp9),
            b"vp08" => Some(Self::Vp8),
            b"mp4a" => Some(Self::Aac),
            _ => None,
        }
    }

    fn codec_id(self) -> &'static str {
        match self {
            Self::Av1 => "V_AV1",
            Self::H264 => "V_MPEG4/ISO/AVC",
            Self::Hevc => "V_MPEGH/ISO/HEVC",
            Self::Vp9 => "V_VP9",
            Self::Vp8 => "V_VP8",
            Self::Aac => "A_AAC",
        }
    }

    pub(super) fn is_video(self) -> bool {
        !matches!(self, Self::Aac)
    }
}

struct SampleRef {
    offset: u64,
    size: u32,
    timestamp_ns: i128,
    /// Decode duration and composition offset in track-timescale ticks, kept for
    /// the progressive-MP4 writer (the Matroska path only needs `timestamp_ns`).
    duration: u32,
    composition_offset: i32,
    keyframe: bool,
}

struct TrackMeta {
    codec: Codec,
    codec_private: Option<Vec<u8>>,
    sample_entry: Vec<u8>,
    edit_media_time: Option<i64>,
    timescale: u32,
    width: u16,
    height: u16,
    channels: u16,
    sample_rate: u32,
    samples: Vec<SampleRef>,
}

/// Reads samples on demand by seeking into the source file, keeping the whole
/// payload off the heap (important for multi-hundred-MB 4K downloads).
pub struct SampleReader {
    file: File,
    samples: std::vec::IntoIter<SampleRef>,
}

impl SampleReader {
    pub fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        let Some(sample) = self.samples.next() else {
            return Ok(None);
        };
        self.file
            .seek(SeekFrom::Start(sample.offset))
            .map_err(|error| format!("Could not seek MP4 sample at {}: {error}", sample.offset))?;
        let mut data = vec![0_u8; sample.size as usize];
        self.file
            .read_exact(&mut data)
            .map_err(|error| format!("Could not read MP4 sample at {}: {error}", sample.offset))?;
        Ok(Some(MatroskaPacket {
            timestamp_ns: sample.timestamp_ns,
            data,
            lacing: None,
            invisible: false,
            discardable: false,
            keyframe: sample.keyframe,
        }))
    }
}

/// One sample's decode timing for the progressive-MP4 writer.
#[derive(Clone, Copy)]
pub(super) struct ProgressiveSample {
    pub(super) offset: u64,
    pub(super) size: u32,
    pub(super) duration: u32,
    pub(super) composition_offset: i32,
    pub(super) is_sync: bool,
}

/// A fragmented-MP4 track parsed for re-wrapping into a progressive (non-fragmented)
/// MP4. Carries the sample description and the full sample list in decode order;
/// bytes are read on demand.
pub(super) struct ProgressiveTrack {
    file: File,
    pub(super) codec: Codec,
    pub(super) timescale: u32,
    pub(super) width: u16,
    pub(super) height: u16,
    /// The source's `stsd` entry box, header included, copied verbatim into the output.
    pub(super) sample_entry: Vec<u8>,
    /// The source edit list's media start, in track ticks (AAC priming, B-frame delay).
    pub(super) edit_media_time: Option<i64>,
    pub(super) samples: Vec<ProgressiveSample>,
}

impl ProgressiveTrack {
    pub(super) fn read_sample(&mut self, sample: ProgressiveSample) -> Result<Vec<u8>, String> {
        self.file
            .seek(SeekFrom::Start(sample.offset))
            .map_err(|error| format!("Could not seek MP4 sample at {}: {error}", sample.offset))?;
        let mut data = vec![0_u8; sample.size as usize];
        self.file
            .read_exact(&mut data)
            .map_err(|error| format!("Could not read MP4 sample at {}: {error}", sample.offset))?;
        Ok(data)
    }
}

/// Parses a fragmented-MP4 track for the progressive-MP4 muxer.
pub(super) fn open_progressive(path: &Path, kind: TrackKind) -> Result<ProgressiveTrack, String> {
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Could not open MP4 {} `{}`: {error}",
            kind.label(),
            path.display()
        )
    })?;
    let meta = parse_metadata(&mut file, kind)?;
    if meta.codec.is_video() != matches!(kind, TrackKind::Video) {
        return Err(format!(
            "The source MP4 `{}` does not contain the expected {}",
            path.display(),
            kind.label()
        ));
    }
    let samples = meta
        .samples
        .iter()
        .map(|sample| ProgressiveSample {
            offset: sample.offset,
            size: sample.size,
            duration: sample.duration,
            composition_offset: sample.composition_offset,
            is_sync: sample.keyframe,
        })
        .collect();
    Ok(ProgressiveTrack {
        file,
        codec: meta.codec,
        timescale: meta.timescale,
        width: meta.width,
        height: meta.height,
        sample_entry: meta.sample_entry,
        edit_media_time: meta.edit_media_time,
        samples,
    })
}

pub fn open(
    path: &Path,
    output_track: u64,
    kind: TrackKind,
) -> Result<(MatroskaSpec, SampleReader), String> {
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Could not open MP4 {} `{}`: {error}",
            kind.label(),
            path.display()
        )
    })?;
    let meta = parse_metadata(&mut file, kind)?;
    if meta.codec.is_video() != matches!(kind, TrackKind::Video) {
        return Err(format!(
            "The source MP4 `{}` does not contain the expected {}",
            path.display(),
            kind.label()
        ));
    }
    let entry = build_track_entry(&meta, output_track);
    Ok((
        entry,
        SampleReader {
            file,
            samples: meta.samples.into_iter(),
        },
    ))
}

fn build_track_entry(meta: &TrackMeta, output_track: u64) -> MatroskaSpec {
    let mut children = vec![
        MatroskaSpec::TrackNumber(output_track),
        MatroskaSpec::TrackUID(output_track),
        MatroskaSpec::TrackType(if meta.codec.is_video() { 1 } else { 2 }),
        MatroskaSpec::FlagLacing(0),
        MatroskaSpec::CodecID(meta.codec.codec_id().to_string()),
    ];
    if let Some(private) = &meta.codec_private {
        children.push(MatroskaSpec::CodecPrivate(private.clone()));
    }
    if meta.codec.is_video() {
        children.push(MatroskaSpec::Video(Master::Full(vec![
            MatroskaSpec::PixelWidth(u64::from(meta.width)),
            MatroskaSpec::PixelHeight(u64::from(meta.height)),
        ])));
    } else {
        children.push(MatroskaSpec::Audio(Master::Full(vec![
            MatroskaSpec::SamplingFrequency(f64::from(meta.sample_rate)),
            MatroskaSpec::Channels(u64::from(meta.channels)),
        ])));
    }
    MatroskaSpec::TrackEntry(Master::Full(children))
}

fn parse_metadata(file: &mut File, kind: TrackKind) -> Result<TrackMeta, String> {
    let label = kind.label();
    let file_len = file
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("Could not size MP4 {label}: {error}"))?;

    // `moov` (the init segment) always precedes the `moof` fragments, so a single
    // forward pass parses the codec config first, then folds each fragment into the
    // sample list and drops it — no need to hold every fragment in memory at once.
    let mut config: Option<MoovConfig> = None;
    let mut samples = Vec::new();
    let mut pos = 0_u64;
    while pos + 8 <= file_len {
        let (box_type, header_len, total) = read_box_header(file, pos, file_len, label)?;
        if total < header_len || pos + total > file_len {
            break;
        }
        match &box_type {
            b"moov" => {
                let payload = read_at(file, pos + header_len, total - header_len, label)?;
                config = Some(parse_moov(&payload, label)?);
            }
            b"moof" => {
                let parsed = config
                    .as_ref()
                    .ok_or_else(|| format!("A {label} fragment preceded its moov header"))?;
                let payload = read_at(file, pos + header_len, total - header_len, label)?;
                parse_moof(pos, &payload, parsed, &mut samples)?;
            }
            _ => {}
        }
        pos += total;
    }

    let config = config.ok_or_else(|| format!("The {label} MP4 is missing its moov box"))?;
    if samples.is_empty() {
        return Err(format!(
            "The {label} MP4 contained no media fragments to remux"
        ));
    }

    Ok(TrackMeta {
        codec: config.entry.codec,
        codec_private: config.entry.codec_private,
        sample_entry: config.entry.raw,
        edit_media_time: config.edit_media_time,
        timescale: config.timescale,
        width: config.entry.width,
        height: config.entry.height,
        channels: config.entry.channels,
        sample_rate: config.entry.sample_rate,
        samples,
    })
}

struct MoovConfig {
    entry: SampleEntryMeta,
    edit_media_time: Option<i64>,
    track_id: u32,
    timescale: u32,
    defaults: FragmentDefaults,
}

fn parse_moov(moov: &[u8], label: &str) -> Result<MoovConfig, String> {
    let trak =
        child(moov, b"trak").ok_or_else(|| format!("The {label} MP4 is missing its trak box"))?;
    let track_id = child(trak, b"tkhd")
        .and_then(parse_tkhd_track_id)
        .unwrap_or(1);
    let mdia =
        child(trak, b"mdia").ok_or_else(|| format!("The {label} MP4 is missing its mdia box"))?;
    let timescale = child(mdia, b"mdhd")
        .and_then(parse_mdhd_timescale)
        .filter(|scale| *scale > 0)
        .ok_or_else(|| format!("The {label} MP4 has an invalid media timescale"))?;
    let stbl = child(mdia, b"minf")
        .and_then(|minf| child(minf, b"stbl"))
        .ok_or_else(|| format!("The {label} MP4 is missing its stbl box"))?;
    let stsd =
        child(stbl, b"stsd").ok_or_else(|| format!("The {label} MP4 is missing its stsd box"))?;
    let entry = parse_sample_entry(stsd, label)?;
    let defaults = child(moov, b"mvex")
        .map(|mvex| trex_defaults(mvex, track_id))
        .unwrap_or_default();
    let edit_media_time = child(trak, b"edts")
        .and_then(|edts| child(edts, b"elst"))
        .and_then(first_media_time);
    Ok(MoovConfig {
        entry,
        edit_media_time,
        track_id,
        timescale,
        defaults,
    })
}

fn parse_moof(
    moof_start: u64,
    moof: &[u8],
    config: &MoovConfig,
    samples: &mut Vec<SampleRef>,
) -> Result<(), String> {
    for traf in children(moof, b"traf") {
        let tfhd = child(traf, b"tfhd")
            .ok_or_else(|| "A media fragment is missing its tfhd box".to_string())?;
        let header = parse_tfhd(tfhd, moof_start, &config.defaults)?;
        if header.track_id != config.track_id {
            continue;
        }
        let mut decode_time = child(traf, b"tfdt")
            .map(parse_tfdt)
            .transpose()?
            .unwrap_or(0);
        let mut cursor: Option<u64> = None;
        for trun in children(traf, b"trun") {
            read_trun(
                trun,
                &header,
                config.timescale,
                config.entry.codec.is_video(),
                &mut decode_time,
                &mut cursor,
                samples,
            )?;
        }
    }
    Ok(())
}

struct SampleEntryMeta {
    codec: Codec,
    raw: Vec<u8>,
    codec_private: Option<Vec<u8>>,
    width: u16,
    height: u16,
    channels: u16,
    sample_rate: u32,
}

fn parse_sample_entry(stsd: &[u8], label: &str) -> Result<SampleEntryMeta, String> {
    let entries = stsd
        .get(8..)
        .ok_or_else(|| format!("The {label} MP4 has a truncated stsd box"))?;
    let (fourcc, payload) = boxes(entries)
        .next()
        .ok_or_else(|| format!("The {label} MP4 has no sample description"))?;
    let raw = raw_first_box(entries)
        .ok_or_else(|| format!("The {label} MP4 has a truncated sample description"))?;
    let codec = Codec::from_fourcc(fourcc).ok_or_else(|| {
        format!(
            "The {label} MP4 uses an unsupported codec `{}`",
            fourcc_label(fourcc)
        )
    })?;

    let (width, height, channels, sample_rate, config) = if codec.is_video() {
        let width = be16(payload, 24)?;
        let height = be16(payload, 26)?;
        let config = payload
            .get(78..)
            .ok_or_else(|| format!("The {label} MP4 has a truncated visual sample entry"))?;
        (width, height, 0, 0, config)
    } else {
        let channels = be16(payload, 16)?;
        let sample_rate = u32::from(be16(payload, 24)?);
        let config = payload
            .get(28..)
            .ok_or_else(|| format!("The {label} MP4 has a truncated audio sample entry"))?;
        (0, 0, channels, sample_rate, config)
    };

    let codec_private = codec_private(codec, config);
    if matches!(codec, Codec::Av1 | Codec::H264 | Codec::Hevc | Codec::Aac)
        && codec_private.is_none()
    {
        return Err(format!(
            "The {label} MP4 is missing the codec configuration required to remux {}",
            codec.codec_id()
        ));
    }

    Ok(SampleEntryMeta {
        codec,
        raw,
        codec_private,
        width,
        height,
        channels,
        sample_rate,
    })
}

fn codec_private(codec: Codec, config: &[u8]) -> Option<Vec<u8>> {
    match codec {
        Codec::Av1 => child(config, b"av1C").map(<[u8]>::to_vec),
        Codec::H264 => child(config, b"avcC").map(<[u8]>::to_vec),
        Codec::Hevc => child(config, b"hvcC").map(<[u8]>::to_vec),
        Codec::Vp9 => child(config, b"vpcC").map(<[u8]>::to_vec),
        Codec::Vp8 => None,
        Codec::Aac => child(config, b"esds").and_then(audio_specific_config),
    }
}

/// Pulls the raw `AudioSpecificConfig` (`DecoderSpecificInfo`) out of an `esds` box.
fn audio_specific_config(esds: &[u8]) -> Option<Vec<u8>> {
    // esds is a FullBox: skip 4 bytes of version+flags, then walk the MPEG-4 descriptors.
    let (es_tag, es_body) = read_descriptor(esds.get(4..)?)?;
    if es_tag != 0x03 {
        return None;
    }
    let mut cursor = 2_usize; // ES_ID (16 bits)
    let flags = *es_body.get(cursor)?;
    cursor += 1;
    if flags & 0x80 != 0 {
        cursor += 2; // dependsOn_ES_ID
    }
    if flags & 0x40 != 0 {
        let url_len = usize::from(*es_body.get(cursor)?);
        cursor += 1 + url_len;
    }
    if flags & 0x20 != 0 {
        cursor += 2; // OCR_ES_Id
    }
    let (dc_tag, dc_body) = read_descriptor(es_body.get(cursor..)?)?;
    if dc_tag != 0x04 {
        return None;
    }
    // DecoderConfigDescriptor fixed header is 13 bytes, then DecoderSpecificInfo.
    let (dsi_tag, dsi_body) = read_descriptor(dc_body.get(13..)?)?;
    if dsi_tag != 0x05 {
        return None;
    }
    Some(dsi_body.to_vec())
}

/// Reads one MPEG-4 descriptor: a tag byte and an expandable length, returning the body.
fn read_descriptor(data: &[u8]) -> Option<(u8, &[u8])> {
    let tag = *data.first()?;
    let mut cursor = 1_usize;
    let mut length = 0_usize;
    for _ in 0..4 {
        let byte = *data.get(cursor)?;
        cursor += 1;
        length = (length << 7) | usize::from(byte & 0x7F);
        if byte & 0x80 == 0 {
            break;
        }
    }
    let body = data.get(cursor..cursor + length)?;
    Some((tag, body))
}

#[derive(Default)]
struct FragmentDefaults {
    duration: u32,
    size: u32,
    flags: u32,
}

fn trex_defaults(mvex: &[u8], track_id: u32) -> FragmentDefaults {
    for trex in children(mvex, b"trex") {
        if be32(trex, 4).ok() == Some(track_id) {
            return FragmentDefaults {
                duration: be32(trex, 12).unwrap_or(0),
                size: be32(trex, 16).unwrap_or(0),
                flags: be32(trex, 20).unwrap_or(0),
            };
        }
    }
    FragmentDefaults::default()
}

struct FragmentHeader {
    track_id: u32,
    base_offset: u64,
    default_duration: u32,
    default_size: u32,
    default_flags: u32,
}

fn parse_tfhd(
    tfhd: &[u8],
    moof_start: u64,
    defaults: &FragmentDefaults,
) -> Result<FragmentHeader, String> {
    let flags = be24(tfhd, 1)?;
    let mut cursor = 4_usize;
    let track_id = be32(tfhd, cursor)?;
    cursor += 4;
    let base_offset = if flags & 0x01 != 0 {
        let value = be64(tfhd, cursor)?;
        cursor += 8;
        value
    } else {
        // default-base-is-moof, or the first track fragment: base at the moof box start.
        moof_start
    };
    if flags & 0x02 != 0 {
        cursor += 4; // sample_description_index
    }
    let default_duration = if flags & 0x08 != 0 {
        let value = be32(tfhd, cursor)?;
        cursor += 4;
        value
    } else {
        defaults.duration
    };
    let default_size = if flags & 0x10 != 0 {
        let value = be32(tfhd, cursor)?;
        cursor += 4;
        value
    } else {
        defaults.size
    };
    let default_flags = if flags & 0x20 != 0 {
        be32(tfhd, cursor)?
    } else {
        defaults.flags
    };
    Ok(FragmentHeader {
        track_id,
        base_offset,
        default_duration,
        default_size,
        default_flags,
    })
}

fn parse_tfdt(tfdt: &[u8]) -> Result<u64, String> {
    if tfdt.first().copied() == Some(1) {
        be64(tfdt, 4)
    } else {
        be32(tfdt, 4).map(u64::from)
    }
}

fn read_trun(
    trun: &[u8],
    header: &FragmentHeader,
    timescale: u32,
    is_video: bool,
    decode_time: &mut u64,
    cursor: &mut Option<u64>,
    samples: &mut Vec<SampleRef>,
) -> Result<(), String> {
    let version = trun.first().copied().unwrap_or(0);
    let flags = be24(trun, 1)?;
    let sample_count = be32(trun, 4)?;
    let mut offset = 8_usize;
    if flags & 0x01 != 0 {
        let data_offset = i64::from(read_i32(trun, offset)?);
        offset += 4;
        *cursor = Some(header.base_offset.wrapping_add_signed(data_offset));
    } else if cursor.is_none() {
        *cursor = Some(header.base_offset);
    }
    let first_sample_flags = if flags & 0x04 != 0 {
        let value = be32(trun, offset)?;
        offset += 4;
        Some(value)
    } else {
        None
    };

    let has_duration = flags & 0x0100 != 0;
    let has_size = flags & 0x0200 != 0;
    let has_flags = flags & 0x0400 != 0;
    let has_cto = flags & 0x0800 != 0;
    let scale = i128::from(timescale);

    for index in 0..sample_count {
        let duration = if has_duration {
            let value = be32(trun, offset)?;
            offset += 4;
            value
        } else {
            header.default_duration
        };
        let size = if has_size {
            let value = be32(trun, offset)?;
            offset += 4;
            value
        } else {
            header.default_size
        };
        let sample_flags = if has_flags {
            let value = be32(trun, offset)?;
            offset += 4;
            value
        } else if index == 0 {
            first_sample_flags.unwrap_or(header.default_flags)
        } else {
            header.default_flags
        };
        let composition_offset = if has_cto {
            let raw = be32(trun, offset)?;
            offset += 4;
            if version == 0 {
                i64::from(raw)
            } else {
                i64::from(i32::from_be_bytes(raw.to_be_bytes()))
            }
        } else {
            0
        };

        let position =
            cursor.ok_or_else(|| "MP4 fragment has no sample data offset".to_string())?;
        let presentation = i128::from(*decode_time) + i128::from(composition_offset);
        samples.push(SampleRef {
            offset: position,
            size,
            timestamp_ns: presentation * NS_PER_SEC / scale,
            duration,
            composition_offset: i32::try_from(composition_offset).unwrap_or(0),
            keyframe: !is_video || (sample_flags & NON_SYNC_FLAG) == 0,
        });
        *cursor = Some(position + u64::from(size));
        *decode_time += u64::from(duration);
    }
    Ok(())
}

/// The first box in `data`, header included.
fn raw_first_box(data: &[u8]) -> Option<Vec<u8>> {
    let size = usize::try_from(u32::from_be_bytes(data.get(..4)?.try_into().ok()?)).ok()?;
    (size >= 8).then(|| data.get(..size).map(<[u8]>::to_vec))?
}

/// The media start of the first non-empty edit in an `elst` box.
fn first_media_time(elst: &[u8]) -> Option<i64> {
    let version = *elst.first()?;
    let count = be32(elst, 4).ok()?;
    let mut offset = 8_usize;
    for _ in 0..count {
        let media_time = if version == 1 {
            let value = i64::from_be_bytes(elst.get(offset + 8..offset + 16)?.try_into().ok()?);
            offset += 20;
            value
        } else {
            let value = i64::from(read_i32(elst, offset + 4).ok()?);
            offset += 12;
            value
        };
        if media_time >= 0 {
            return Some(media_time);
        }
    }
    None
}

fn parse_tkhd_track_id(tkhd: &[u8]) -> Option<u32> {
    let offset = if tkhd.first().copied() == Some(1) {
        20
    } else {
        12
    };
    be32(tkhd, offset).ok()
}

fn parse_mdhd_timescale(mdhd: &[u8]) -> Option<u32> {
    let offset = if mdhd.first().copied() == Some(1) {
        20
    } else {
        12
    };
    be32(mdhd, offset).ok()
}

fn read_box_header(
    file: &mut File,
    pos: u64,
    file_len: u64,
    label: &str,
) -> Result<([u8; 4], u64, u64), String> {
    file.seek(SeekFrom::Start(pos))
        .map_err(|error| format!("Could not seek MP4 {label}: {error}"))?;
    let mut header = [0_u8; 8];
    file.read_exact(&mut header)
        .map_err(|error| format!("Could not read MP4 {label} box header: {error}"))?;
    let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    let box_type = [header[4], header[5], header[6], header[7]];
    if size32 == 1 {
        let mut large = [0_u8; 8];
        file.read_exact(&mut large)
            .map_err(|error| format!("Could not read MP4 {label} extended size: {error}"))?;
        Ok((box_type, 16, u64::from_be_bytes(large)))
    } else if size32 == 0 {
        Ok((box_type, 8, file_len - pos))
    } else {
        Ok((box_type, 8, u64::from(size32)))
    }
}

fn read_at(file: &mut File, start: u64, len: u64, label: &str) -> Result<Vec<u8>, String> {
    let len = usize::try_from(len).map_err(|_| format!("MP4 {label} box is too large"))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("Could not seek MP4 {label}: {error}"))?;
    let mut buffer = vec![0_u8; len];
    file.read_exact(&mut buffer)
        .map_err(|error| format!("Could not read MP4 {label} box: {error}"))?;
    Ok(buffer)
}

struct Boxes<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Iterator for Boxes<'a> {
    type Item = ([u8; 4], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        let header = self.data.get(self.pos..self.pos + 8)?;
        let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let fourcc = [header[4], header[5], header[6], header[7]];
        let (header_len, total) = match size {
            1 => {
                let large = self.data.get(self.pos + 8..self.pos + 16)?;
                let large = usize::try_from(u64::from_be_bytes(large.try_into().ok()?)).ok()?;
                (16, large)
            }
            0 => (8, self.data.len() - self.pos),
            other => (8, other),
        };
        if total < header_len || self.pos + total > self.data.len() {
            return None;
        }
        let payload = &self.data[self.pos + header_len..self.pos + total];
        self.pos += total;
        Some((fourcc, payload))
    }
}

fn boxes(data: &[u8]) -> Boxes<'_> {
    Boxes { data, pos: 0 }
}

fn child<'a>(data: &'a [u8], want: &[u8]) -> Option<&'a [u8]> {
    boxes(data).find_map(|(fourcc, payload)| (fourcc == *want).then_some(payload))
}

fn children<'a>(data: &'a [u8], want: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
    boxes(data).filter_map(move |(fourcc, payload)| (fourcc == *want).then_some(payload))
}

fn be16(data: &[u8], offset: usize) -> Result<u16, String> {
    data.get(offset..offset + 2)
        .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
        .ok_or_else(|| "MP4 box ended before a 16-bit field".to_string())
}

fn be24(data: &[u8], offset: usize) -> Result<u32, String> {
    data.get(offset..offset + 3)
        .map(|bytes| u32::from_be_bytes([0, bytes[0], bytes[1], bytes[2]]))
        .ok_or_else(|| "MP4 box ended before a 24-bit field".to_string())
}

fn be32(data: &[u8], offset: usize) -> Result<u32, String> {
    data.get(offset..offset + 4)
        .map(|bytes| u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .ok_or_else(|| "MP4 box ended before a 32-bit field".to_string())
}

fn read_i32(data: &[u8], offset: usize) -> Result<i32, String> {
    data.get(offset..offset + 4)
        .map(|bytes| i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .ok_or_else(|| "MP4 box ended before a 32-bit field".to_string())
}

fn be64(data: &[u8], offset: usize) -> Result<u64, String> {
    data.get(offset..offset + 8)
        .map(|bytes| {
            u64::from_be_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ])
        })
        .ok_or_else(|| "MP4 box ended before a 64-bit field".to_string())
}

fn fourcc_label(fourcc: [u8; 4]) -> String {
    fourcc
        .iter()
        .map(|byte| {
            if byte.is_ascii_graphic() {
                char::from(*byte)
            } else {
                '?'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{be24, boxes, read_descriptor};

    fn mp4_box(kind: &[u8], payload: &[u8]) -> Vec<u8> {
        let total = u32::try_from(8 + payload.len()).expect("test box fits in u32");
        let mut out = total.to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    #[test]
    fn iterates_sibling_boxes() {
        let mut data = mp4_box(b"ftyp", &[1, 2, 3, 4]);
        data.extend(mp4_box(b"moov", &[9, 9]));
        let found: Vec<_> = boxes(&data)
            .map(|(fourcc, payload)| (fourcc, payload.to_vec()))
            .collect();
        assert_eq!(found.len(), 2);
        assert_eq!(&found[0].0, b"ftyp");
        assert_eq!(found[0].1, vec![1, 2, 3, 4]);
        assert_eq!(&found[1].0, b"moov");
        assert_eq!(found[1].1, vec![9, 9]);
    }

    #[test]
    fn reads_a_24_bit_field() {
        assert_eq!(be24(&[0x00, 0x01, 0x00, 0x00], 1), Ok(0x0001_0000));
    }

    #[test]
    fn reads_expandable_descriptor_length() {
        // Tag 0x05, length 0x81 0x01 (continuation byte) -> 129 bytes.
        let mut data = vec![0x05, 0x81, 0x01];
        data.resize(data.len() + 129, 0xAA);
        let (tag, body) = read_descriptor(&data).expect("descriptor");
        assert_eq!(tag, 0x05);
        assert_eq!(body.len(), 129);
    }
}
