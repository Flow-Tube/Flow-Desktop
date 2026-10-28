//! Matroska output for the downloads MP4 cannot hold (VP8, or video with no AAC).
//!
//! The file is laid out so players can start and seek without scanning it: a
//! reserved head that ends up holding the `SeekHead` and `Info` (with the length),
//! `Tracks`, the clusters, then `Cues`, `Chapters`, `Tags` and the cover attachment.
//! The head and the segment size are filled in once everything else is written.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use webm_iterable::matroska_spec::{Master, MatroskaSpec, SimpleBlock};
use webm_iterable::{WebmWriter, WriteOptions};

use super::{EmbeddedMetadata, MatroskaPacket, PacketSource};

const SEGMENT_ID: [u8; 4] = [0x18, 0x53, 0x80, 0x67];
const CLUSTER_ID: [u8; 4] = [0x1F, 0x43, 0xB6, 0x75];
const VOID_ID: u8 = 0xEC;
const SEEK_INFO: [u8; 4] = [0x15, 0x49, 0xA9, 0x66];
const SEEK_TRACKS: [u8; 4] = [0x16, 0x54, 0xAE, 0x6B];
const SEEK_CUES: [u8; 4] = [0x1C, 0x53, 0xBB, 0x6B];
const SEEK_CHAPTERS: [u8; 4] = [0x10, 0x43, 0xA7, 0x70];
const SEEK_TAGS: [u8; 4] = [0x12, 0x54, 0xC3, 0x67];
const SEEK_ATTACHMENTS: [u8; 4] = [0x19, 0x41, 0xA4, 0x69];
/// Room for the `SeekHead` and `Info`; a long title fits with plenty to spare.
const HEAD_BYTES: usize = 4096;
const CLUSTER_MS: i64 = 5_000;
const WRITE_BUFFER_BYTES: usize = 1024 * 1024;

/// One input track: its `TrackEntry` (numbered for the output) and its packets.
pub(super) struct MatroskaInput {
    pub entry: MatroskaSpec,
    pub packets: PacketSource,
    pub is_video: bool,
}

struct Output {
    out: BufWriter<File>,
    pos: u64,
}

impl Output {
    fn put(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.out
            .write_all(bytes)
            .map_err(|error| format!("Could not write Matroska output: {error}"))?;
        self.pos += bytes.len() as u64;
        Ok(())
    }
}

/// Where an element sits: the writer checks the element tree, so an element is encoded
/// inside unknown-sized parents and only its own bytes are kept.
#[derive(Clone, Copy)]
enum Parent {
    Root,
    Segment,
    Cluster,
}

fn encode_in(parent: Parent, spec: &MatroskaSpec) -> Result<Vec<u8>, String> {
    let error =
        |error: &dyn std::fmt::Display| format!("Could not encode a Matroska element: {error}");
    let open = |writer: &mut WebmWriter<Vec<u8>>| -> Result<(), String> {
        if matches!(parent, Parent::Segment | Parent::Cluster) {
            writer
                .write_advanced(
                    &MatroskaSpec::Segment(Master::Start),
                    WriteOptions::is_unknown_sized_element(),
                )
                .map_err(|e| error(&e))?;
        }
        if matches!(parent, Parent::Cluster) {
            writer
                .write_advanced(
                    &MatroskaSpec::Cluster(Master::Start),
                    WriteOptions::is_unknown_sized_element(),
                )
                .map_err(|e| error(&e))?;
        }
        Ok(())
    };
    let mut prefix = WebmWriter::new(Vec::new());
    open(&mut prefix)?;
    let skip = prefix.into_inner().map_err(|e| error(&e))?.len();
    let mut writer = WebmWriter::new(Vec::new());
    open(&mut writer)?;
    writer.write(spec).map_err(|e| error(&e))?;
    let mut bytes = writer.into_inner().map_err(|e| error(&e))?;
    bytes.drain(..skip);
    Ok(bytes)
}

fn encode(spec: &MatroskaSpec) -> Result<Vec<u8>, String> {
    encode_in(Parent::Segment, spec)
}

/// An element header with an 8-byte size, so the size can be patched in place.
fn sized_header(id: &[u8], size: u64) -> Vec<u8> {
    let mut header = id.to_vec();
    header.push(0x01);
    header.extend_from_slice(&size.to_be_bytes()[1..]);
    header
}

/// A `Void` element exactly `total` bytes long (at least 9).
fn void_element(total: usize) -> Vec<u8> {
    let mut element = vec![VOID_ID];
    element.extend(sized_header(&[], (total - 9) as u64));
    element.resize(total, 0);
    element
}

pub(super) fn write_matroska(
    output_path: &Path,
    mut inputs: Vec<MatroskaInput>,
    metadata: Option<&EmbeddedMetadata>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let file = File::create(output_path)
        .map_err(|error| format!("Could not create Matroska output: {error}"))?;
    let mut output = Output {
        out: BufWriter::with_capacity(WRITE_BUFFER_BYTES, file),
        pos: 0,
    };
    output.put(&encode_in(
        Parent::Root,
        &MatroskaSpec::Ebml(Master::Full(vec![
            MatroskaSpec::EbmlVersion(1),
            MatroskaSpec::EbmlReadVersion(1),
            MatroskaSpec::EbmlMaxIdLength(4),
            MatroskaSpec::EbmlMaxSizeLength(8),
            MatroskaSpec::DocType("matroska".to_string()),
            MatroskaSpec::DocTypeVersion(4),
            MatroskaSpec::DocTypeReadVersion(2),
        ])),
    )?)?;
    let segment_size_at = output.pos + 4;
    output.put(&sized_header(&SEGMENT_ID, 0))?;
    let segment_start = output.pos;
    output.put(&void_element(HEAD_BYTES))?;

    let tracks_at = output.pos - segment_start;
    let entries: Vec<MatroskaSpec> = inputs.iter().map(|input| input.entry.clone()).collect();
    output.put(&encode(&MatroskaSpec::Tracks(Master::Full(entries)))?)?;

    let clusters = write_clusters(&mut output, &mut inputs, segment_start, cancelled)?;
    let duration_ms = clusters.duration_ms;
    let cues = clusters.cues;
    let cue_track = clusters.cue_track;
    let mut seeks = vec![(SEEK_TRACKS, tracks_at)];
    if !cues.is_empty() {
        seeks.push((SEEK_CUES, output.pos - segment_start));
        output.put(&encode(&cues_element(&cues, cue_track))?)?;
    }
    if let Some(metadata) = metadata {
        if !metadata.chapters.is_empty() {
            seeks.push((SEEK_CHAPTERS, output.pos - segment_start));
            output.put(&encode(&chapters_element(metadata, duration_ms))?)?;
        }
        seeks.push((SEEK_TAGS, output.pos - segment_start));
        output.put(&encode(&tags_element(metadata))?)?;
        if let Some(cover) = metadata
            .cover
            .as_deref()
            .filter(|cover| cover.starts_with(&[0xFF, 0xD8, 0xFF]))
        {
            seeks.push((SEEK_ATTACHMENTS, output.pos - segment_start));
            output.put(&encode(&attachments_element(cover))?)?;
        }
    }
    let segment_end = output.pos;

    let title = metadata.map(|metadata| metadata.tags.title.clone());
    let info = encode(&info_element(duration_ms, title))?;
    let info_at = 0_u64;
    let mut head = Vec::new();
    // SeekHead first, then Info; Info's position depends on the SeekHead's size.
    let mut seek_head = encode(&seek_head_element(&seeks, info_at))?;
    let info_offset = seek_head.len() as u64;
    seek_head = encode(&seek_head_element(&seeks, info_offset))?;
    head.extend(seek_head);
    head.extend(info);
    if head.len() + 9 > HEAD_BYTES {
        return Err("The file's header is larger than the space kept for it".into());
    }
    head.extend(void_element(HEAD_BYTES - head.len()));

    output
        .out
        .flush()
        .map_err(|error| format!("Could not flush Matroska output: {error}"))?;
    let mut file = output
        .out
        .into_inner()
        .map_err(|error| format!("Could not flush Matroska output: {error}"))?;
    let io = |error: std::io::Error| format!("Could not finish Matroska output: {error}");
    file.seek(SeekFrom::Start(segment_start)).map_err(io)?;
    file.write_all(&head).map_err(io)?;
    file.seek(SeekFrom::Start(segment_size_at)).map_err(io)?;
    file.write_all(&sized_header(&[], segment_end - segment_start)[..8])
        .map_err(io)?;
    file.sync_all().map_err(io)
}

/// What writing the clusters leaves behind for the index and the header.
struct ClusterSummary {
    cues: Vec<(u64, u64)>,
    cue_track: u64,
    duration_ms: i64,
}

/// Interleaves every input's packets by time into clusters, starting a new one on a
/// video key frame every five seconds, and notes where each can be seeked to.
fn write_clusters(
    output: &mut Output,
    inputs: &mut [MatroskaInput],
    segment_start: u64,
    cancelled: &AtomicBool,
) -> Result<ClusterSummary, String> {
    let video_track = inputs
        .iter()
        .position(|input| input.is_video)
        .map(|index| index as u64 + 1);
    let cue_track = video_track.unwrap_or(1);
    let mut next: Vec<Option<MatroskaPacket>> = inputs
        .iter_mut()
        .map(|input| input.packets.next_packet())
        .collect::<Result<_, _>>()?;
    let mut cues: Vec<(u64, u64)> = Vec::new();
    let mut cluster: Vec<u8> = Vec::new();
    let mut cluster_start: Option<i64> = None;
    let mut cluster_offset = 0_u64;
    let mut last_ms = vec![(0_i64, 0_i64); inputs.len()];

    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        let Some(index) = next
            .iter()
            .enumerate()
            .filter_map(|(index, packet)| packet.as_ref().map(|p| (index, p.timestamp_ns)))
            .min_by_key(|(_, timestamp)| *timestamp)
            .map(|(index, _)| index)
        else {
            break;
        };
        let packet = next[index].take().expect("the chosen packet is present");
        let track = index as u64 + 1;
        let timestamp_ms = i64::try_from(packet.timestamp_ns / 1_000_000)
            .map_err(|_| "Matroska timestamp is outside the supported range".to_string())?
            .max(0);
        let (previous, _) = last_ms[index];
        last_ms[index] = (timestamp_ms, timestamp_ms - previous);

        let rotate = match cluster_start {
            None => true,
            Some(start) => {
                let relative = timestamp_ms - start;
                relative > i64::from(i16::MAX)
                    || (Some(track) == video_track && packet.keyframe && relative >= CLUSTER_MS)
                    || (video_track.is_none() && relative >= CLUSTER_MS)
            }
        };
        if rotate {
            flush_cluster(output, &mut cluster)?;
            cluster_start = Some(timestamp_ms);
            cluster_offset = output.pos - segment_start;
            let start = u64::try_from(timestamp_ms).unwrap_or(0);
            cluster.extend(encode_in(Parent::Cluster, &MatroskaSpec::Timestamp(start))?);
            if track == cue_track {
                cues.push((start, cluster_offset));
            }
        } else if track == cue_track
            && packet.keyframe
            && cues
                .last()
                .is_none_or(|(_, offset)| *offset != cluster_offset)
        {
            cues.push((u64::try_from(timestamp_ms).unwrap_or(0), cluster_offset));
        }
        let relative = i16::try_from(timestamp_ms - cluster_start.unwrap_or(timestamp_ms))
            .map_err(|_| "Matroska block timestamp exceeded its cluster range".to_string())?;
        let block = SimpleBlock::new_uncheked(
            packet.data.as_slice(),
            track,
            relative,
            packet.invisible,
            packet.lacing,
            packet.discardable,
            packet.keyframe,
        );
        cluster.extend(encode_in(Parent::Cluster, &MatroskaSpec::from(block))?);
        next[index] = inputs[index].packets.next_packet()?;
    }
    flush_cluster(output, &mut cluster)?;

    // The length runs to the end of the latest frame: its start plus the gap before it.
    let duration_ms = last_ms
        .iter()
        .map(|(last, gap)| last + gap.max(&0))
        .max()
        .unwrap_or(0);
    Ok(ClusterSummary {
        cues,
        cue_track,
        duration_ms,
    })
}

fn flush_cluster(output: &mut Output, cluster: &mut Vec<u8>) -> Result<(), String> {
    if cluster.is_empty() {
        return Ok(());
    }
    output.put(&sized_header(&CLUSTER_ID, cluster.len() as u64))?;
    output.put(cluster)?;
    cluster.clear();
    Ok(())
}

fn info_element(duration_ms: i64, title: Option<String>) -> MatroskaSpec {
    let mut children = vec![
        MatroskaSpec::TimestampScale(1_000_000),
        MatroskaSpec::Duration(f64::from(
            u32::try_from(duration_ms.max(0)).unwrap_or(u32::MAX),
        )),
    ];
    if let Some(title) = title.filter(|title| !title.is_empty()) {
        children.push(MatroskaSpec::Title(title));
    }
    children.push(MatroskaSpec::MuxingApp("Flow".to_string()));
    children.push(MatroskaSpec::WritingApp("Flow".to_string()));
    MatroskaSpec::Info(Master::Full(children))
}

fn seek_head_element(seeks: &[([u8; 4], u64)], info_at: u64) -> MatroskaSpec {
    let mut entries = vec![seek_entry(SEEK_INFO, info_at)];
    entries.extend(
        seeks
            .iter()
            .map(|(id, position)| seek_entry(*id, *position)),
    );
    MatroskaSpec::SeekHead(Master::Full(entries))
}

fn seek_entry(id: [u8; 4], position: u64) -> MatroskaSpec {
    MatroskaSpec::Seek(Master::Full(vec![
        MatroskaSpec::SeekID(id.to_vec()),
        MatroskaSpec::SeekPosition(position),
    ]))
}

fn cues_element(cues: &[(u64, u64)], track: u64) -> MatroskaSpec {
    MatroskaSpec::Cues(Master::Full(
        cues.iter()
            .map(|(time, position)| {
                MatroskaSpec::CuePoint(Master::Full(vec![
                    MatroskaSpec::CueTime(*time),
                    MatroskaSpec::CueTrackPositions(Master::Full(vec![
                        MatroskaSpec::CueTrack(track),
                        MatroskaSpec::CueClusterPosition(*position),
                    ])),
                ]))
            })
            .collect(),
    ))
}

fn chapters_element(metadata: &EmbeddedMetadata, duration_ms: i64) -> MatroskaSpec {
    let end_of = |index: usize| -> u64 {
        metadata
            .chapters
            .get(index + 1)
            .map_or(u64::try_from(duration_ms).unwrap_or(0), |next| {
                next.start_ms
            })
    };
    let atoms = metadata
        .chapters
        .iter()
        .enumerate()
        .map(|(index, chapter)| {
            MatroskaSpec::ChapterAtom(Master::Full(vec![
                MatroskaSpec::ChapterUID(index as u64 + 1),
                MatroskaSpec::ChapterTimeStart(chapter.start_ms.saturating_mul(1_000_000)),
                MatroskaSpec::ChapterTimeEnd(end_of(index).saturating_mul(1_000_000)),
                MatroskaSpec::ChapterDisplay(Master::Full(vec![
                    MatroskaSpec::ChapString(chapter.title.clone()),
                    MatroskaSpec::ChapLanguage("und".to_string()),
                ])),
            ]))
        });
    let mut edition = vec![MatroskaSpec::EditionUID(1)];
    edition.extend(atoms);
    MatroskaSpec::Chapters(Master::Full(vec![MatroskaSpec::EditionEntry(
        Master::Full(edition),
    )]))
}

/// The same fields as the MP4 `ilst`, with the names ffmpeg, VLC and mpv read, plus
/// the Flow IDs as `FLOW_*` tags.
fn tags_element(metadata: &EmbeddedMetadata) -> MatroskaSpec {
    let tags = &metadata.tags;
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut push = |name: &str, value: Option<String>| {
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            pairs.push((name.to_string(), value));
        }
    };
    push("TITLE", Some(tags.title.clone()));
    push("ARTIST", tags.display_artist());
    push("ALBUM", tags.album.clone());
    push("ALBUM_ARTIST", tags.album_artist.clone());
    push("PART_NUMBER", tags.track_number.map(|n| n.to_string()));
    push("TOTAL_PARTS", tags.track_total.map(|n| n.to_string()));
    push("DATE_RELEASED", tags.release_date.clone());
    push("GENRE", tags.genre.clone());
    push("DESCRIPTION", tags.truncated_description());
    push("COMMENT", tags.source_url());
    push("URL", tags.source_url());
    push("LYRICS", tags.lyrics.clone());
    push("ENCODER", Some("Flow".to_string()));
    for (name, value) in tags.flow_fields() {
        push(&format!("FLOW_{}", name.to_ascii_uppercase()), Some(value));
    }
    let mut children = vec![MatroskaSpec::Targets(Master::Full(vec![
        MatroskaSpec::TargetTypeValue(50),
    ]))];
    children.extend(pairs.into_iter().map(|(name, value)| {
        MatroskaSpec::SimpleTag(Master::Full(vec![
            MatroskaSpec::TagName(name),
            MatroskaSpec::TagString(value),
        ]))
    }));
    MatroskaSpec::Tags(Master::Full(vec![MatroskaSpec::Tag(Master::Full(
        children,
    ))]))
}

/// `cover.jpg` is the name VLC, mpv, Kodi and Jellyfin look for.
fn attachments_element(cover: &[u8]) -> MatroskaSpec {
    MatroskaSpec::Attachments(Master::Full(vec![MatroskaSpec::AttachedFile(
        Master::Full(vec![
            MatroskaSpec::FileDescription("Cover".to_string()),
            MatroskaSpec::FileName("cover.jpg".to_string()),
            MatroskaSpec::FileMimeType("image/jpeg".to_string()),
            MatroskaSpec::FileData(cover.to_vec()),
            MatroskaSpec::FileUID(1),
        ]),
    )]))
}

#[cfg(test)]
mod tests {
    use super::{HEAD_BYTES, sized_header, void_element};

    #[test]
    fn void_elements_have_the_exact_length() {
        for total in [9, 10, 300, HEAD_BYTES] {
            let element = void_element(total);
            assert_eq!(element.len(), total);
            assert_eq!(element[0], 0xEC);
            assert_eq!(element[1], 0x01);
        }
    }

    #[test]
    fn sizes_use_eight_byte_vints() {
        assert_eq!(
            sized_header(&[0x1F, 0x43, 0xB6, 0x75], 300),
            vec![0x1F, 0x43, 0xB6, 0x75, 0x01, 0, 0, 0, 0, 0, 0x01, 0x2C]
        );
    }
}
