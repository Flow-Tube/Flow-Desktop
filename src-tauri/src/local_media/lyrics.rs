//! A song's own lyrics: a `.lrc` beside it, else the lyrics embedded in the file. Nothing here
//! touches the network, and a song with neither has no lyrics.

use std::path::Path;

use encoding_rs::Encoding;
use lofty::file::TaggedFileExt;
use lofty::prelude::ItemKey;
use serde::Serialize;

use super::bounds::LibraryBounds;
use super::text::decode_text;

const MAX_LYRICS_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLyrics {
    pub text: String,
    pub embedded: bool,
}

/// The sidecar of `audio_name` among `siblings`: `Song.lrc` or `Song.mp3.lrc`, in any case.
pub fn matching_lyrics_file<'a>(audio_name: &str, siblings: &'a [String]) -> Option<&'a str> {
    let stem = audio_name
        .rsplit_once('.')
        .map_or(audio_name, |(stem, _)| stem);
    [format!("{stem}.lrc"), format!("{audio_name}.lrc")]
        .iter()
        .find_map(|wanted| {
            siblings
                .iter()
                .find(|name| name.eq_ignore_ascii_case(wanted))
        })
        .map(String::as_str)
}

fn sidecar_lyrics(
    audio: &Path,
    bounds: &LibraryBounds,
    legacy: Option<&'static Encoding>,
) -> Option<String> {
    let folder = audio.parent()?;
    let audio_name = audio.file_name()?.to_str()?;
    let siblings: Vec<String> = std::fs::read_dir(folder)
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let name = matching_lyrics_file(audio_name, &siblings)?;
    let path = bounds.sidecar(&folder.join(name), &["lrc"])?;
    if std::fs::metadata(&path).ok()?.len() > MAX_LYRICS_FILE_BYTES {
        return None;
    }
    let text = decode_text(&std::fs::read(path).ok()?, legacy);
    (!text.trim().is_empty()).then_some(text)
}

fn embedded_lyrics(audio: &Path) -> Option<String> {
    let tagged = lofty::probe::Probe::open(audio)
        .ok()?
        .options(lofty::config::ParseOptions::new().read_cover_art(false))
        .read()
        .ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    tag.get_string(ItemKey::Lyrics)
        .map(str::to_owned)
        .filter(|text| !text.trim().is_empty())
}

pub fn read_lyrics(
    audio: &Path,
    bounds: &LibraryBounds,
    legacy: Option<&'static Encoding>,
) -> Option<LocalLyrics> {
    sidecar_lyrics(audio, bounds, legacy)
        .map(|text| LocalLyrics {
            text,
            embedded: false,
        })
        .or_else(|| {
            embedded_lyrics(audio).map(|text| LocalLyrics {
                text,
                embedded: true,
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn finds_a_sidecar_by_either_name_in_any_case() {
        let siblings = names(&["SONG.LRC", "other.lrc"]);
        assert_eq!(
            matching_lyrics_file("song.mp3", &siblings),
            Some("SONG.LRC")
        );
        let siblings = names(&["song.mp3.lrc"]);
        assert_eq!(
            matching_lyrics_file("song.mp3", &siblings),
            Some("song.mp3.lrc")
        );
        assert_eq!(
            matching_lyrics_file("song.mp3", &names(&["songs.lrc"])),
            None
        );
    }

    #[test]
    fn reads_the_file_beside_the_song_and_refuses_a_large_one() {
        let dir = std::env::temp_dir().join(format!("flow-lyrics-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        let audio = dir.join("song.mp3");
        std::fs::write(&audio, b"not audio").unwrap();
        let bounds = LibraryBounds::new(vec![dir.clone()], Vec::new());
        assert_eq!(read_lyrics(&audio, &bounds, None), None);

        std::fs::write(dir.join("song.lrc"), "[00:01.00]Hello").unwrap();
        let found = read_lyrics(&audio, &bounds, None).unwrap();
        assert_eq!(
            found,
            LocalLyrics {
                text: "[00:01.00]Hello".into(),
                embedded: false
            }
        );

        std::fs::write(dir.join("song.lrc"), vec![b'x'; 600 * 1024]).unwrap();
        assert_eq!(read_lyrics(&audio, &bounds, None), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
