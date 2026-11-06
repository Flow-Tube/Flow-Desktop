//! A file's cover: the picture embedded in it, an image named like it, or for a song the cover
//! its folder holds. Each file is looked at once: the result, found or not, is kept until the
//! file changes.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{ImageFormat, ImageReader, Limits};
use lofty::file::TaggedFileExt;
use lofty::picture::PictureType;

use super::bounds::LibraryBounds;
use super::{LocalMediaFile, MediaKind, formats};

const COVER_STEMS: [&str; 4] = ["cover", "folder", "front", "album"];
const COVER_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
const ALBUM_ART_PREFIX: &str = "albumart";
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;
const COVER_SIZE_PX: u32 = 640;
const MISSING_SUFFIX: &str = ".none";

fn has_image_extension(name: &str) -> bool {
    COVER_EXTENSIONS.contains(&formats::extension_of(Path::new(name)).as_str())
}

fn stem_of(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// The cover image among a folder's `names`, by the names players and rippers use, most specific
/// first.
pub fn folder_cover_name(names: &[String]) -> Option<&str> {
    let images: Vec<&String> = names
        .iter()
        .filter(|name| has_image_extension(name))
        .collect();
    COVER_STEMS
        .iter()
        .find_map(|stem| {
            images
                .iter()
                .find(|name| stem_of(name).eq_ignore_ascii_case(stem))
        })
        .or_else(|| {
            images
                .iter()
                .find(|name| name.to_lowercase().starts_with(ALBUM_ART_PREFIX))
        })
        .map(|name| name.as_str())
}

/// An image named like the media file: `Film.jpg` beside `Film.mkv`.
pub fn same_name_image<'a>(media_name: &str, names: &'a [String]) -> Option<&'a str> {
    let stem = stem_of(media_name);
    names
        .iter()
        .find(|name| has_image_extension(name) && stem_of(name).eq_ignore_ascii_case(stem))
        .map(String::as_str)
}

fn embedded_picture(media: &Path) -> Option<Vec<u8>> {
    let tagged = lofty::probe::Probe::open(media).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let pictures = tag.pictures();
    pictures
        .iter()
        .find(|picture| picture.pic_type() == PictureType::CoverFront)
        .or_else(|| pictures.first())
        .map(|picture| picture.data().to_vec())
}

fn image_file(folder: &Path, name: &str, bounds: &LibraryBounds) -> Option<Vec<u8>> {
    let path = bounds.sidecar(&folder.join(name), &COVER_EXTENSIONS)?;
    if std::fs::metadata(&path).ok()?.len() > MAX_COVER_BYTES {
        return None;
    }
    std::fs::read(path).ok()
}

fn find_cover(media: &Path, kind: MediaKind, bounds: &LibraryBounds) -> Option<Vec<u8>> {
    if let Some(picture) = embedded_picture(media) {
        return Some(picture);
    }
    let folder = media.parent()?;
    let media_name = media.file_name()?.to_str()?;
    let names: Vec<String> = std::fs::read_dir(folder)
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    if let Some(cover) =
        same_name_image(media_name, &names).and_then(|name| image_file(folder, name, bounds))
    {
        return Some(cover);
    }
    // A video folder's `cover.jpg` usually belongs to the whole series or to nothing.
    if kind == MediaKind::Audio {
        return folder_cover_name(&names).and_then(|name| image_file(folder, name, bounds));
    }
    None
}

/// A scan or a phone photo re-encoded at artwork size, so it doesn't sit full size in the cache.
fn shrink(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let picture = reader
        .decode()
        .ok()?
        .thumbnail(COVER_SIZE_PX, COVER_SIZE_PX)
        .into_rgb8();
    let mut out = Cursor::new(Vec::new());
    picture.write_to(&mut out, ImageFormat::Jpeg).ok()?;
    Some(out.into_inner())
}

/// Where the file's cover is cached, reading it the first time. Blocking.
pub fn cached_cover(
    cache_dir: &Path,
    file: &LocalMediaFile,
    media: &Path,
    bounds: &LibraryBounds,
) -> Option<PathBuf> {
    let name = format!("{}_{}_{}", file.id, file.modified_ms, file.size_bytes);
    let cached = cache_dir.join(format!("{name}.jpg"));
    let missing = cache_dir.join(format!("{name}{MISSING_SUFFIX}"));
    if cached.is_file() {
        return Some(cached);
    }
    if missing.is_file() {
        return None;
    }
    let kind = if file.kind == MediaKind::Video.as_str() {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };
    let cover = find_cover(media, kind, bounds).and_then(|bytes| shrink(&bytes));
    let _ = std::fs::create_dir_all(cache_dir);
    if let Some(cover) = cover {
        std::fs::write(&cached, cover).ok().map(|()| cached)
    } else {
        let _ = std::fs::write(missing, []);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_string()).collect()
    }

    fn png() -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        image::RgbImage::new(2000, 1000)
            .write_to(&mut out, ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn picks_the_most_specific_folder_cover() {
        assert_eq!(
            folder_cover_name(&names(&["a.jpg", "Folder.PNG", "cover.jpg"])),
            Some("cover.jpg")
        );
        assert_eq!(
            folder_cover_name(&names(&["AlbumArt_x.jpg", "song.mp3"])),
            Some("AlbumArt_x.jpg")
        );
        assert_eq!(folder_cover_name(&names(&["cover.txt", "a.jpg"])), None);
    }

    #[test]
    fn an_image_named_like_the_file_is_its_cover() {
        assert_eq!(
            same_name_image("Film.mkv", &names(&["film.JPG", "Film.mkv"])),
            Some("film.JPG")
        );
        assert_eq!(same_name_image("Film.mkv", &names(&["Other.jpg"])), None);
    }

    #[test]
    fn shrinks_to_artwork_size_and_refuses_what_isnt_an_image() {
        let small = shrink(&png()).unwrap();
        let decoded = image::load_from_memory(&small).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (640, 320));
        assert_eq!(shrink(b"not an image"), None);
    }

    fn file_row(id: &str, kind: MediaKind) -> LocalMediaFile {
        LocalMediaFile {
            id: id.into(),
            path: String::new(),
            folder_path: String::new(),
            kind: kind.as_str().into(),
            title: String::new(),
            file_name: String::new(),
            artist: String::new(),
            album: String::new(),
            duration_ms: 0,
            size_bytes: 1,
            added_ms: 0,
            modified_ms: 1,
            width: 0,
            height: 0,
            frame_rate: None,
            bitrate_kbps: None,
            video_codec: String::new(),
            audio_codec: String::new(),
        }
    }

    #[test]
    fn a_song_takes_its_folders_cover_and_a_video_doesnt_and_the_answer_is_kept() {
        let dir = std::env::temp_dir().join(format!("flow-covers-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        let cache = dir.join("cache");
        let library = dir.join("library");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(library.join("cover.png"), png()).unwrap();
        let song = library.join("song.mp3");
        std::fs::write(&song, b"x").unwrap();
        let video = library.join("film.mp4");
        std::fs::write(&video, b"x").unwrap();
        let bounds = LibraryBounds::new(vec![library.clone()], Vec::new());

        let cached =
            cached_cover(&cache, &file_row("a", MediaKind::Audio), &song, &bounds).unwrap();
        assert!(cached.is_file());
        assert_eq!(
            cached_cover(&cache, &file_row("b", MediaKind::Video), &video, &bounds),
            None
        );

        std::fs::write(library.join("film.png"), png()).unwrap();
        assert_eq!(
            cached_cover(&cache, &file_row("b", MediaKind::Video), &video, &bounds),
            None
        );
        let mut changed = file_row("b", MediaKind::Video);
        changed.modified_ms = 2;
        assert!(cached_cover(&cache, &changed, &video, &bounds).is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
