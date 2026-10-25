//! Changes one tag of a finished MP4 without re-downloading it.
//!
//! When the new `moov` fits in the space the old one and its `free` pad take, it is
//! rewritten there and the media never moves. Otherwise the file is rebuilt into a
//! copy with every chunk offset shifted, checked, and renamed over the original.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use super::RETAG_PADDING;
use super::boxes::mp4_box;
use super::validate;

const MAX_MOOV_BYTES: u64 = 64 * 1024 * 1024;
const LYRICS: &[u8] = b"\xA9lyr";

struct TopBox {
    kind: [u8; 4],
    pos: u64,
    len: u64,
}

/// Sets (or, with an empty `lyrics`, removes) the `©lyr` atom.
pub fn set_mp4_lyrics(path: &Path, lyrics: &str) -> Result<(), String> {
    let item = (!lyrics.trim().is_empty()).then(|| {
        let mut data = vec![0, 0, 0, 1, 0, 0, 0, 0];
        data.extend_from_slice(lyrics.as_bytes());
        mp4_box(LYRICS, &mp4_box(b"data", &data))
    });
    rewrite_moov(path, |moov| {
        replace_ilst_item(moov, LYRICS, item.as_deref())
    })
}

fn rewrite_moov(
    path: &Path,
    edit: impl FnOnce(&[u8]) -> Result<Vec<u8>, String>,
) -> Result<(), String> {
    let io = |error: std::io::Error| format!("Could not retag the file: {error}");
    let mut file = File::open(path).map_err(io)?;
    let boxes = top_level_boxes(&mut file)?;
    if boxes.iter().any(|entry| &entry.kind == b"moof") {
        return Err("Fragmented files are not retagged".into());
    }
    let moov_index = boxes
        .iter()
        .position(|entry| &entry.kind == b"moov")
        .ok_or("The file has no moov box")?;
    let moov = &boxes[moov_index];
    if moov.len > MAX_MOOV_BYTES {
        return Err("The file's index is too large to retag".into());
    }
    let mut old = vec![0_u8; usize::try_from(moov.len).map_err(|_| "moov is too large")?];
    file.seek(SeekFrom::Start(moov.pos)).map_err(io)?;
    file.read_exact(&mut old).map_err(io)?;
    let new_moov = edit(&old[8..]).map(|payload| mp4_box(b"moov", &payload))?;
    let new_len = new_moov.len() as u64;
    drop(file);

    let pad = boxes
        .get(moov_index + 1)
        .filter(|entry| &entry.kind == b"free" || &entry.kind == b"skip")
        .map_or(0, |entry| entry.len);
    let available = moov.len + pad;
    let is_last = moov_index + 1 == boxes.len();

    if new_len == available || (new_len + 8 <= available) || is_last {
        // Same place: the media keeps its offsets.
        let mut out = OpenOptions::new().write(true).open(path).map_err(io)?;
        out.seek(SeekFrom::Start(moov.pos)).map_err(io)?;
        out.write_all(&new_moov).map_err(io)?;
        if is_last {
            out.set_len(moov.pos + new_len).map_err(io)?;
        } else if new_len < available {
            out.write_all(&free_header(available - new_len))
                .map_err(io)?;
        }
        return out.sync_all().map_err(io);
    }

    // Media after `moov` moves by the size change, so every chunk offset does too.
    let fresh_pad = u64::from(RETAG_PADDING);
    let media_follows = boxes[moov_index + 1..]
        .iter()
        .any(|entry| &entry.kind == b"mdat");
    let delta = if media_follows {
        i64::try_from(new_len + fresh_pad).unwrap_or(i64::MAX)
            - i64::try_from(available).unwrap_or(i64::MAX)
    } else {
        0
    };
    let shifted = shift_chunk_offsets(&new_moov, delta)?;
    let staged = path.with_extension("retag.flowpart");
    let result = rebuild(
        path,
        &staged,
        &boxes,
        moov_index,
        pad > 0,
        &shifted,
        fresh_pad,
    )
    .and_then(|()| {
        validate::validate_mp4(
            &staged,
            validate::OutputExpectation {
                video: false,
                audio: false,
                duration_seconds: None,
            },
        )
    })
    .and_then(|()| std::fs::rename(&staged, path).map_err(io));
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}

fn rebuild(
    source: &Path,
    staged: &Path,
    boxes: &[TopBox],
    moov_index: usize,
    skip_pad: bool,
    moov: &[u8],
    pad: u64,
) -> Result<(), String> {
    let io = |error: std::io::Error| format!("Could not retag the file: {error}");
    let mut input = BufReader::new(File::open(source).map_err(io)?);
    let mut output = BufWriter::new(File::create(staged).map_err(io)?);
    for (index, entry) in boxes.iter().enumerate() {
        if index == moov_index {
            output.write_all(moov).map_err(io)?;
            output.write_all(&free_header(pad)).map_err(io)?;
            continue;
        }
        if skip_pad && index == moov_index + 1 {
            continue;
        }
        input.seek(SeekFrom::Start(entry.pos)).map_err(io)?;
        std::io::copy(&mut (&mut input).take(entry.len), &mut output).map_err(io)?;
    }
    output.flush().map_err(io)?;
    output
        .into_inner()
        .map_err(|error| format!("Could not retag the file: {error}"))?
        .sync_all()
        .map_err(io)
}

/// A `free` box of `len` bytes; only its header needs writing over stale bytes, but
/// the payload is zeroed so no old tag text survives in it.
fn free_header(len: u64) -> Vec<u8> {
    let payload = usize::try_from(len.saturating_sub(8)).unwrap_or(0);
    mp4_box(b"free", &vec![0; payload])
}

fn top_level_boxes(file: &mut File) -> Result<Vec<TopBox>, String> {
    let io = |error: std::io::Error| format!("Could not read the file: {error}");
    let len = file.seek(SeekFrom::End(0)).map_err(io)?;
    let mut boxes = Vec::new();
    let mut pos = 0_u64;
    while pos + 8 <= len {
        file.seek(SeekFrom::Start(pos)).map_err(io)?;
        let mut header = [0_u8; 8];
        file.read_exact(&mut header).map_err(io)?;
        let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let kind = [header[4], header[5], header[6], header[7]];
        let total = match size {
            1 => {
                let mut large = [0_u8; 8];
                file.read_exact(&mut large).map_err(io)?;
                u64::from_be_bytes(large)
            }
            0 => len - pos,
            size => u64::from(size),
        };
        if total < 8 || pos + total > len {
            return Err("The file ends inside a box".into());
        }
        boxes.push(TopBox {
            kind,
            pos,
            len: total,
        });
        pos += total;
    }
    Ok(boxes)
}

/// A child box: its type and its whole bytes, header included.
type ChildBox<'a> = ([u8; 4], &'a [u8]);

/// Child boxes of `payload`.
fn children(payload: &[u8]) -> Result<Vec<ChildBox<'_>>, String> {
    let mut out = Vec::new();
    let mut pos = 0_usize;
    while pos + 8 <= payload.len() {
        let size = usize::try_from(u32::from_be_bytes([
            payload[pos],
            payload[pos + 1],
            payload[pos + 2],
            payload[pos + 3],
        ]))
        .unwrap_or(0);
        if size < 8 || pos + size > payload.len() {
            return Err("The file's index has a damaged box".into());
        }
        let kind = [
            payload[pos + 4],
            payload[pos + 5],
            payload[pos + 6],
            payload[pos + 7],
        ];
        out.push((kind, &payload[pos..pos + size]));
        pos += size;
    }
    Ok(out)
}

/// Rebuilds `moov` with `item` in place of any `want` atom in `udta/meta/ilst`,
/// creating `udta`, `meta` and `ilst` when they are missing.
fn replace_ilst_item(moov: &[u8], want: &[u8], item: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(moov.len() + item.map_or(0, <[u8]>::len));
    let mut found_udta = false;
    for (kind, whole) in children(moov)? {
        if &kind == b"udta" {
            found_udta = true;
            out.extend(mp4_box(b"udta", &rewrite_udta(&whole[8..], want, item)?));
        } else {
            out.extend_from_slice(whole);
        }
    }
    if !found_udta {
        out.extend(mp4_box(b"udta", &rewrite_udta(&[], want, item)?));
    }
    Ok(out)
}

fn rewrite_udta(udta: &[u8], want: &[u8], item: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut found_meta = false;
    for (kind, whole) in children(udta)? {
        if &kind == b"meta" {
            found_meta = true;
            let body = whole.get(12..).ok_or("The file has a damaged meta box")?;
            let mut meta = whole[8..12].to_vec();
            meta.extend(rewrite_meta(body, want, item)?);
            out.extend(mp4_box(b"meta", &meta));
        } else {
            out.extend_from_slice(whole);
        }
    }
    if !found_meta {
        let ilst = mp4_box(b"ilst", item.unwrap_or_default());
        out.extend(super::ilst::meta_box(&ilst));
    }
    Ok(out)
}

fn rewrite_meta(meta: &[u8], want: &[u8], item: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut found_ilst = false;
    for (kind, whole) in children(meta)? {
        if &kind == b"ilst" {
            found_ilst = true;
            let mut items = Vec::new();
            for (item_kind, item_box) in children(&whole[8..])? {
                if item_kind != want {
                    items.extend_from_slice(item_box);
                }
            }
            if let Some(item) = item {
                items.extend_from_slice(item);
            }
            out.extend(mp4_box(b"ilst", &items));
        } else {
            out.extend_from_slice(whole);
        }
    }
    if !found_ilst {
        out.extend(mp4_box(b"ilst", item.unwrap_or_default()));
    }
    Ok(out)
}

/// Adds `delta` to every `stco`/`co64` entry under `moov`.
fn shift_chunk_offsets(moov: &[u8], delta: i64) -> Result<Vec<u8>, String> {
    let mut out = moov.to_vec();
    shift_in(&mut out[8..], delta)?;
    Ok(out)
}

fn shift_in(payload: &mut [u8], delta: i64) -> Result<(), String> {
    let mut pos = 0_usize;
    while pos + 8 <= payload.len() {
        let size = usize::try_from(u32::from_be_bytes(
            payload[pos..pos + 4].try_into().expect("four bytes"),
        ))
        .unwrap_or(0);
        if size < 8 || pos + size > payload.len() {
            return Err("The file's index has a damaged box".into());
        }
        let kind: [u8; 4] = payload[pos + 4..pos + 8].try_into().expect("four bytes");
        let body = &mut payload[pos + 8..pos + size];
        match &kind {
            b"trak" | b"mdia" | b"minf" | b"stbl" => shift_in(body, delta)?,
            b"stco" => {
                let count = read_count(body)?;
                for index in 0..count {
                    let at = 8 + index * 4;
                    let slot = body.get_mut(at..at + 4).ok_or("stco is truncated")?;
                    let value = i64::from(u32::from_be_bytes(slot.try_into().expect("four bytes")));
                    let shifted =
                        u32::try_from(value + delta).map_err(|_| "A chunk moved past 4 GiB")?;
                    slot.copy_from_slice(&shifted.to_be_bytes());
                }
            }
            b"co64" => {
                let count = read_count(body)?;
                for index in 0..count {
                    let at = 8 + index * 8;
                    let slot = body.get_mut(at..at + 8).ok_or("co64 is truncated")?;
                    let value = u64::from_be_bytes(slot.try_into().expect("eight bytes"));
                    let shifted = value
                        .checked_add_signed(delta)
                        .ok_or("A chunk offset went out of range")?;
                    slot.copy_from_slice(&shifted.to_be_bytes());
                }
            }
            _ => {}
        }
        pos += size;
    }
    Ok(())
}

fn read_count(body: &[u8]) -> Result<usize, String> {
    body.get(4..8)
        .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
        .map(u32::from_be_bytes)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| "A chunk offset table is truncated".to_string())
}

#[cfg(test)]
mod tests {
    use super::set_mp4_lyrics;
    use crate::commands::downloads::muxer::mp4_writer::tests::{audio_track, options, samples};
    use crate::commands::downloads::muxer::mp4_writer::{Mp4Options, write_mp4};
    use crate::commands::downloads::muxer::validate::inspect_mp4_bytes;
    use crate::commands::downloads::muxer::{EmbeddedMetadata, ilst};
    use std::sync::atomic::AtomicBool;

    fn tagged_song(tag: &str) -> std::path::PathBuf {
        let path = crate::commands::downloads::muxer::scratch_file(tag, "m4a");
        let options = Mp4Options {
            udta: Some(ilst::udta_box(&EmbeddedMetadata::default())),
            ..options()
        };
        write_mp4(
            &path,
            vec![audio_track(samples(200, 50, 1024, 1))],
            &options,
            &AtomicBool::new(false),
        )
        .expect("writes");
        path
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn first_sample_matches(bytes: &[u8]) -> bool {
        let inspection = inspect_mp4_bytes(bytes).expect("parses");
        let at = usize::try_from(inspection.tracks[0].first_chunk_offset).expect("fits");
        bytes[at..at + 50].iter().all(|byte| *byte == 0)
            && inspection.mdat_payload == inspection.tracks[0].sample_bytes
    }

    #[test]
    fn short_lyrics_fit_in_the_pad_without_moving_media() {
        let path = tagged_song("retag-fit");
        let before = std::fs::read(&path).expect("reads");
        set_mp4_lyrics(&path, "[00:01.00]Hello").expect("retags");
        let after = std::fs::read(&path).expect("reads");
        assert_eq!(before.len(), after.len());
        assert!(contains(&after, b"[00:01.00]Hello"));
        assert!(first_sample_matches(&after));
    }

    #[test]
    fn long_lyrics_move_the_media_and_its_offsets() {
        let path = tagged_song("retag-shift");
        let long = "la ".repeat(40_000);
        set_mp4_lyrics(&path, &long).expect("retags");
        let after = std::fs::read(&path).expect("reads");
        assert!(contains(&after, long.as_bytes()));
        assert!(first_sample_matches(&after));
        set_mp4_lyrics(&path, "").expect("removes");
        let cleared = std::fs::read(&path).expect("reads");
        assert!(!contains(&cleared, b"\xA9lyr"));
        assert!(first_sample_matches(&cleared));
    }
}
