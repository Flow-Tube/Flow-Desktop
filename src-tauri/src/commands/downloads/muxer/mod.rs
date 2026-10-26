use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use webm_iterable::WebmIterator;
use webm_iterable::matroska_spec::{BlockLacing, Master, MatroskaSpec, SimpleBlock};

use crate::api::innertube::download::DownloadContainer;

mod boxes;
mod ilst;
mod matroska;
mod mp4_demux;
mod mp4_writer;
pub mod retag;
pub mod validate;
mod vp9;

pub use ilst::{EmbeddedChapter, EmbeddedMetadata, MAX_COVER_BYTES};

use mp4_demux::{Codec, ProgressiveSample, ProgressiveTrack};
use mp4_writer::{Mp4Options, SampleSource, TrackRole, WriterSample, WriterTrack};

/// Bytes left free after `moov` so tags (synced lyrics above all) can be rewritten
/// later without moving the media data.
const RETAG_PADDING: u32 = 64 * 1024;
/// `WebM` timestamps are in milliseconds; 90 kHz keeps them exact in MP4.
const WEBM_VIDEO_TIMESCALE: u32 = 90_000;

/// Which half of an adaptive pair a track is, used for diagnostics and demuxer selection.
#[derive(Clone, Copy)]
enum TrackKind {
    Video,
    Audio,
}

impl TrackKind {
    fn label(self) -> &'static str {
        match self {
            Self::Video => "video track",
            Self::Audio => "audio track",
        }
    }
}

/// One downloaded track: where it is, the container its bytes arrived in, and its
/// mime type (VP9's `vpcC` fields come from the codecs string).
#[derive(Clone, Copy)]
pub struct TrackInput<'a> {
    pub path: &'a Path,
    pub container: DownloadContainer,
    pub mime_type: &'a str,
}

/// Muxes a downloaded video and audio track into a single output file.
///
/// `output` selects the destination container; each input's `container` is the one
/// its bytes really arrived in, which can differ from `output`: AV1 ships as
/// fragmented MP4 and VP9 as `WebM`, and both end up in MP4 next to AAC.
pub fn mux_adaptive_tracks(
    output: DownloadContainer,
    video: TrackInput<'_>,
    audio: TrackInput<'_>,
    output_path: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    match output {
        DownloadContainer::Mp4 => mux_mp4(video, audio, output_path, metadata, cancelled),
        DownloadContainer::Mkv => {
            let (video_entry, video_packets) =
                open_track_source(video.container, video.path, 1, TrackKind::Video)?;
            let (audio_entry, audio_packets) =
                open_track_source(audio.container, audio.path, 2, TrackKind::Audio)?;
            matroska::write_matroska(
                output_path,
                vec![
                    matroska::MatroskaInput {
                        entry: video_entry,
                        packets: video_packets,
                        is_video: true,
                    },
                    matroska::MatroskaInput {
                        entry: audio_entry,
                        packets: audio_packets,
                        is_video: false,
                    },
                ],
                metadata,
                cancelled,
            )
        }
    }
}

/// Writes a progressive MP4 from a fragmented-MP4 or `WebM` VP9 video track and a
/// fragmented-MP4 AAC track, with the tags and cover in `moov/udta`.
fn mux_mp4(
    video: TrackInput<'_>,
    audio: TrackInput<'_>,
    output_path: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let (video_track, video_codec) = match video.container {
        DownloadContainer::Mp4 => {
            let track = mp4_demux::open_progressive(video.path, TrackKind::Video)?;
            if matches!(track.codec, Codec::Vp8) {
                return Err("VP8 video cannot be stored in MP4".to_string());
            }
            let codec = track.codec;
            (fragmented_writer_track(track, TrackKind::Video), codec)
        }
        DownloadContainer::Mkv => (
            webm_vp9_writer_track(video.path, video.mime_type)?,
            Codec::Vp9,
        ),
    };
    if audio.container != DownloadContainer::Mp4 {
        return Err("MP4 downloads need an AAC audio track".to_string());
    }
    let audio_track = mp4_demux::open_progressive(audio.path, TrackKind::Audio)?;
    if !matches!(audio_track.codec, Codec::Aac) {
        return Err("MP4 downloads need an AAC audio track".to_string());
    }
    let audio_track = fragmented_writer_track(audio_track, TrackKind::Audio);

    let mut compatible_brands = vec![*b"isom", *b"iso2", *b"mp41"];
    match video_codec {
        Codec::H264 => compatible_brands.push(*b"avc1"),
        Codec::Av1 => compatible_brands.push(*b"av01"),
        _ => {}
    }
    let options = Mp4Options {
        major_brand: *b"isom",
        compatible_brands,
        udta: metadata.map(ilst::udta_box),
        padding: RETAG_PADDING,
    };
    mp4_writer::write_mp4(
        output_path,
        vec![video_track, audio_track],
        &options,
        cancelled,
    )
}

/// Rewrites a downloaded fragmented AAC track as a progressive, tagged M4A.
pub fn remux_audio_to_m4a(
    input: &Path,
    output: &Path,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let track = mp4_demux::open_progressive(input, TrackKind::Audio)?;
    if !matches!(track.codec, Codec::Aac) {
        return Err("Only AAC audio is saved as M4A".to_string());
    }
    let options = Mp4Options {
        major_brand: *b"M4A ",
        compatible_brands: vec![*b"M4A ", *b"isom", *b"iso2", *b"mp42"],
        udta: metadata.map(ilst::udta_box),
        padding: RETAG_PADDING,
    };
    mp4_writer::write_mp4(
        output,
        vec![fragmented_writer_track(track, TrackKind::Audio)],
        &options,
        cancelled,
    )
}

impl SampleSource for ProgressiveTrack {
    fn read_sample(&mut self, index: usize, _sample: &WriterSample) -> Result<Vec<u8>, String> {
        let sample: ProgressiveSample = *self
            .samples
            .get(index)
            .ok_or_else(|| format!("MP4 sample {index} is out of range"))?;
        ProgressiveTrack::read_sample(self, sample)
    }
}

fn fragmented_writer_track(track: ProgressiveTrack, kind: TrackKind) -> WriterTrack<'static> {
    let samples: Vec<WriterSample> = track
        .samples
        .iter()
        .map(|sample| WriterSample {
            size: sample.size,
            duration: sample.duration,
            composition_offset: sample.composition_offset,
            is_sync: sample.is_sync,
        })
        .collect();
    let role = match kind {
        TrackKind::Video => TrackRole::Video {
            width: track.width,
            height: track.height,
        },
        TrackKind::Audio => TrackRole::Audio,
    };
    let media_time = track
        .edit_media_time
        .or_else(|| first_presentation_time(&samples));
    WriterTrack {
        role,
        timescale: track.timescale,
        sample_entry: track.sample_entry.clone(),
        samples,
        media_time,
        source: Box::new(track),
    }
}

/// The earliest presentation time when the stream starts after zero, as B-frame
/// video does when the source declared no edit list.
fn first_presentation_time(samples: &[WriterSample]) -> Option<i64> {
    let mut decode = 0_i64;
    let mut earliest: Option<i64> = None;
    for sample in samples.iter().take(256) {
        let presentation = decode + i64::from(sample.composition_offset);
        earliest = Some(earliest.map_or(presentation, |value| value.min(presentation)));
        decode += i64::from(sample.duration);
    }
    earliest.filter(|time| *time > 0)
}

/// Reads a `WebM` VP9 track's frames in order for the MP4 writer.
struct WebmFrameSource {
    track: MatroskaTrack,
    next: usize,
}

impl SampleSource for WebmFrameSource {
    fn read_sample(&mut self, index: usize, _sample: &WriterSample) -> Result<Vec<u8>, String> {
        if index != self.next {
            return Err(format!(
                "WebM frames must be read in order (wanted {index}, at {})",
                self.next
            ));
        }
        self.next += 1;
        self.track
            .next_packet()?
            .map(|packet| packet.data)
            .ok_or_else(|| "The WebM video track ended early".to_string())
    }
}

fn webm_vp9_writer_track(path: &Path, mime_type: &str) -> Result<WriterTrack<'static>, String> {
    let (entry, source_track) = read_matroska_track_entry(path, 1, TrackKind::Video.label())?;
    let (codec_id, width, height, default_duration) = webm_video_info(&entry);
    if codec_id.as_deref() != Some("V_VP9") {
        return Err(format!(
            "Only VP9 WebM video can be stored in MP4 (got {})",
            codec_id.unwrap_or_else(|| "an unknown codec".to_string())
        ));
    }

    let mut scan = MatroskaTrack::open(path, source_track, TrackKind::Video.label())?;
    let mut frames: Vec<(i128, u32, bool)> = Vec::new();
    let mut first_keyframe: Option<Vec<u8>> = None;
    while let Some(packet) = scan.next_packet()? {
        if packet.keyframe && first_keyframe.is_none() {
            first_keyframe = Some(packet.data.clone());
        }
        let size = u32::try_from(packet.data.len())
            .map_err(|_| "A WebM video frame is larger than 4 GiB".to_string())?;
        frames.push((packet.timestamp_ns, size, packet.keyframe));
    }
    if frames.is_empty() {
        return Err("The WebM video track has no frames".to_string());
    }

    let ticks = |ns: i128| -> i64 {
        i64::try_from(ns * i128::from(WEBM_VIDEO_TIMESCALE) / 1_000_000_000).unwrap_or(0)
    };
    let fallback = default_duration
        .map(|ns| ticks(i128::from(ns)))
        .filter(|value| *value > 0)
        .unwrap_or(i64::from(WEBM_VIDEO_TIMESCALE / 30));
    let mut samples = Vec::with_capacity(frames.len());
    let mut previous_duration = fallback;
    for (index, (timestamp, size, keyframe)) in frames.iter().enumerate() {
        let duration = frames
            .get(index + 1)
            .map_or(previous_duration, |(next, _, _)| {
                ticks(*next) - ticks(*timestamp)
            })
            .max(1);
        previous_duration = duration;
        samples.push(WriterSample {
            size: *size,
            duration: u32::try_from(duration).unwrap_or(u32::MAX),
            composition_offset: 0,
            is_sync: *keyframe,
        });
    }

    let config = vp9::Vp9Config::resolve(mime_type, first_keyframe.as_deref());
    Ok(WriterTrack {
        role: TrackRole::Video { width, height },
        timescale: WEBM_VIDEO_TIMESCALE,
        sample_entry: vp9::vp09_sample_entry(width, height, config),
        samples,
        media_time: None,
        source: Box::new(WebmFrameSource {
            track: MatroskaTrack::open(path, source_track, TrackKind::Video.label())?,
            next: 0,
        }),
    })
}

/// Codec ID, pixel size and default frame duration (ns) of a `WebM` video entry.
fn webm_video_info(entry: &MatroskaSpec) -> (Option<String>, u16, u16, Option<u64>) {
    let MatroskaSpec::TrackEntry(Master::Full(children)) = entry else {
        return (None, 0, 0, None);
    };
    let mut codec_id = None;
    let mut width = 0;
    let mut height = 0;
    let mut default_duration = None;
    for child in children {
        match child {
            MatroskaSpec::CodecID(id) => codec_id = Some(id.clone()),
            MatroskaSpec::DefaultDuration(ns) => default_duration = Some(*ns),
            MatroskaSpec::Video(Master::Full(video)) => {
                for field in video {
                    match field {
                        MatroskaSpec::PixelWidth(value) => {
                            width = u16::try_from(*value).unwrap_or(u16::MAX);
                        }
                        MatroskaSpec::PixelHeight(value) => {
                            height = u16::try_from(*value).unwrap_or(u16::MAX);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    (codec_id, width, height, default_duration)
}

/// A single coded frame, normalized so video (`WebM` or fragmented MP4) and audio
/// (`WebM`) tracks interleave through one Matroska writer.
#[derive(Clone)]
struct MatroskaPacket {
    timestamp_ns: i128,
    data: Vec<u8>,
    lacing: Option<BlockLacing>,
    invisible: bool,
    discardable: bool,
    keyframe: bool,
}

/// A demuxed track that yields [`MatroskaPacket`]s regardless of its source container.
/// The `WebM` iterator carries large internal buffers, so it is boxed to keep the
/// two variants similarly sized.
enum PacketSource {
    Webm(Box<MatroskaTrack>),
    Mp4(mp4_demux::SampleReader),
}

impl PacketSource {
    fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        match self {
            Self::Webm(track) => track.next_packet(),
            Self::Mp4(reader) => reader.next_packet(),
        }
    }
}

fn open_track_source(
    container: DownloadContainer,
    path: &Path,
    output_track: u64,
    kind: TrackKind,
) -> Result<(MatroskaSpec, PacketSource), String> {
    match container {
        DownloadContainer::Mkv => {
            let (entry, source_track) =
                read_matroska_track_entry(path, output_track, kind.label())?;
            let track = MatroskaTrack::open(path, source_track, kind.label())?;
            Ok((entry, PacketSource::Webm(Box::new(track))))
        }
        DownloadContainer::Mp4 => {
            let (entry, reader) = mp4_demux::open(path, output_track, kind)?;
            Ok((entry, PacketSource::Mp4(reader)))
        }
    }
}

struct MatroskaTrack {
    iterator: WebmIterator<File>,
    track_number: u64,
    timestamp_scale: u64,
    cluster_timestamp: i64,
    source_label: &'static str,
    source_path: PathBuf,
}

impl MatroskaTrack {
    fn open(path: &Path, track_number: u64, source_label: &'static str) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| {
            format!(
                "Could not open Matroska {source_label} `{}`: {error}",
                path.display()
            )
        })?;
        Ok(Self {
            iterator: WebmIterator::new(file, &[]),
            track_number,
            timestamp_scale: 1_000_000,
            cluster_timestamp: 0,
            source_label,
            source_path: path.to_path_buf(),
        })
    }

    fn next_packet(&mut self) -> Result<Option<MatroskaPacket>, String> {
        for tag in self.iterator.by_ref() {
            let tag = tag.map_err(|error| {
                format!(
                    "Invalid Matroska {} packet stream in `{}`: {error}",
                    self.source_label,
                    self.source_path.display()
                )
            })?;
            match tag {
                MatroskaSpec::TimestampScale(scale) => self.timestamp_scale = scale.max(1),
                MatroskaSpec::Timestamp(timestamp) => {
                    self.cluster_timestamp = i64::try_from(timestamp)
                        .map_err(|_| "Matroska cluster timestamp is too large".to_string())?;
                }
                MatroskaSpec::SimpleBlock(data) => {
                    let block = SimpleBlock::try_from(data.as_slice())
                        .map_err(|error| format!("Invalid Matroska block: {error}"))?;
                    if block.track != self.track_number {
                        continue;
                    }
                    let absolute_ticks =
                        i128::from(self.cluster_timestamp) + i128::from(block.timestamp);
                    return Ok(Some(MatroskaPacket {
                        timestamp_ns: absolute_ticks * i128::from(self.timestamp_scale),
                        data: block.raw_frame_data().to_vec(),
                        lacing: block.lacing,
                        invisible: block.invisible,
                        discardable: block.discardable,
                        keyframe: block.keyframe,
                    }));
                }
                _ => {}
            }
        }
        Ok(None)
    }
}

fn read_matroska_track_entry(
    path: &Path,
    output_track: u64,
    source_label: &'static str,
) -> Result<(MatroskaSpec, u64), String> {
    let diagnostics = media_file_diagnostics(path);
    let file = File::open(path).map_err(|error| {
        format!(
            "Could not open Matroska {source_label} `{}`: {error}",
            path.display()
        )
    })?;
    let iterator = WebmIterator::new(file, &[MatroskaSpec::TrackEntry(Master::Start)]);
    for tag in iterator {
        let tag = tag.map_err(|error| {
            format!(
                "Invalid Matroska {source_label} metadata in `{}` ({diagnostics}): {error}",
                path.display()
            )
        })?;
        let MatroskaSpec::TrackEntry(Master::Full(mut children)) = tag else {
            continue;
        };
        let source_track = children.iter().find_map(|child| match child {
            MatroskaSpec::TrackNumber(number) => Some(*number),
            _ => None,
        });
        let track_type = children.iter().find_map(|child| match child {
            MatroskaSpec::TrackType(value) => Some(*value),
            _ => None,
        });
        let wanted_type = if output_track == 1 { 1 } else { 2 };
        if track_type != Some(wanted_type) {
            continue;
        }
        for child in &mut children {
            match child {
                MatroskaSpec::TrackNumber(number) | MatroskaSpec::TrackUID(number) => {
                    *number = output_track;
                }
                _ => {}
            }
        }
        return Ok((
            MatroskaSpec::TrackEntry(Master::Full(children)),
            source_track.unwrap_or(1),
        ));
    }
    Err(if output_track == 1 {
        "The source WebM does not contain a video track".to_string()
    } else {
        "The source WebM does not contain an audio track".to_string()
    })
}

fn media_file_diagnostics(path: &Path) -> String {
    let size = path.metadata().map_or(0, |metadata| metadata.len());
    let mut prefix = [0_u8; 32];
    let read = File::open(path)
        .and_then(|mut file| file.read(&mut prefix))
        .unwrap_or(0);
    let prefix = prefix[..read]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!("size={size} bytes, first {read} bytes=[{prefix}]")
}

#[cfg(test)]
pub(super) fn scratch_file(tag: &str, extension: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!("flow-mux-{tag}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir.join(format!("out.{extension}"))
}

#[cfg(test)]
mod tests {
    use super::{WriterSample, first_presentation_time};

    fn sample(duration: u32, composition_offset: i32) -> WriterSample {
        WriterSample {
            size: 1,
            duration,
            composition_offset,
            is_sync: true,
        }
    }

    #[test]
    fn b_frame_streams_start_at_their_first_presented_frame() {
        let samples = [sample(1000, 2000), sample(1000, 4000), sample(1000, 0)];
        assert_eq!(first_presentation_time(&samples), Some(2000));
        assert_eq!(first_presentation_time(&[sample(1000, 0)]), None);
    }
}
