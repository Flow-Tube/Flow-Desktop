//! Writes a backup's files: the zip layout of Android's `MasterBackupZip`, or one JSON file. Every
//! write goes to a partial file first, so a failed backup leaves the last good one in place.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use serde_json::Value;
use zip::CompressionMethod;
use zip::write::{SimpleFileOptions, ZipWriter};

pub const APP_DATA_ENTRY: &str = "app_data.json";
pub const ENGINE_ENTRY: &str = "engine_brain.json";
pub const MUSIC_ENTRY: &str = "music_brain.json";
pub const MANIFEST_ENTRY: &str = "manifest.json";
pub const PROFILES_DIR: &str = "profiles/";
pub const AVATARS_DIR: &str = "profile_avatars/";

/// One profile's files in the archive.
pub struct Slice {
    pub app_data: Value,
    pub engine: Option<Value>,
    pub music: Option<Value>,
}

/// A master or brain backup. Default's slice sits at the root, where an older app restores it.
pub struct Archive {
    pub root: Slice,
    pub manifest: Option<Value>,
    pub profiles: Vec<(String, Slice)>,
    pub avatars: Vec<(String, Vec<u8>)>,
}

fn partial_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".partial");
    path.with_file_name(name)
}

/// Runs `write` against a partial file and moves it over `path` only once it is complete.
pub fn write_atomic(
    path: &Path,
    write: impl FnOnce(BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    let partial = partial_path(path);
    let result = File::create(&partial)
        .and_then(|file| write(BufWriter::new(file)))
        .and_then(|()| std::fs::rename(&partial, path));
    if result.is_err() {
        // Nothing to report beyond the failure itself: the partial file may not even exist.
        let _ = std::fs::remove_file(&partial);
    }
    result
}

pub fn write_json(path: &Path, value: &Value) -> io::Result<()> {
    write_atomic(path, |mut out| {
        serde_json::to_writer(&mut out, value)?;
        out.flush()?;
        out.into_inner()
            .map_err(io::IntoInnerError::into_error)?
            .sync_all()
    })
}

fn write_slice<W: Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    prefix: &str,
    slice: &Slice,
    options: SimpleFileOptions,
) -> io::Result<()> {
    let mut entry = |name: &str, value: &Value| -> io::Result<()> {
        zip.start_file(format!("{prefix}{name}"), options)
            .map_err(io::Error::other)?;
        serde_json::to_writer(&mut *zip, value)?;
        Ok(())
    };
    entry(APP_DATA_ENTRY, &slice.app_data)?;
    if let Some(engine) = &slice.engine {
        entry(ENGINE_ENTRY, engine)?;
    }
    if let Some(music) = &slice.music {
        entry(MUSIC_ENTRY, music)?;
    }
    Ok(())
}

pub fn write_archive(path: &Path, archive: &Archive) -> io::Result<()> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    write_atomic(path, |out| {
        let mut zip = ZipWriter::new(out);
        write_slice(&mut zip, "", &archive.root, options)?;
        for (id, slice) in &archive.profiles {
            write_slice(&mut zip, &format!("{PROFILES_DIR}{id}/"), slice, options)?;
        }
        for (id, photo) in &archive.avatars {
            zip.start_file(format!("{AVATARS_DIR}{id}.webp"), options)
                .map_err(io::Error::other)?;
            zip.write_all(photo)?;
        }
        if let Some(manifest) = &archive.manifest {
            zip.start_file(MANIFEST_ENTRY, options)
                .map_err(io::Error::other)?;
            serde_json::to_writer(&mut zip, manifest)?;
        }
        let mut out = zip.finish().map_err(io::Error::other)?;
        out.flush()?;
        out.into_inner()
            .map_err(io::IntoInnerError::into_error)?
            .sync_all()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_failed_write_keeps_the_last_good_file() {
        let dir = std::env::temp_dir().join(format!("flow-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("flow_backup.json");
        write_json(&path, &json!({ "good": true })).unwrap();

        let failed = write_atomic(&path, |_| Err(io::Error::other("disk full")));
        assert!(failed.is_err());

        let kept: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(kept["good"], true);
        assert!(!partial_path(&path).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
