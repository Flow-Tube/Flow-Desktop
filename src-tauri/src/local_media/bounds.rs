//! What the library may open right now: inside a chosen folder, outside an excluded one.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use super::scan::resolved_folders;
use super::{FolderRole, formats};
use crate::db::local_media as db;
use crate::errors::AppResult;
use crate::security::validation::validate_library_file;

#[derive(Debug, Clone, Default)]
pub struct LibraryBounds {
    roots: Vec<PathBuf>,
    excludes: Vec<PathBuf>,
}

impl LibraryBounds {
    pub fn new(roots: Vec<PathBuf>, excludes: Vec<PathBuf>) -> Self {
        Self { roots, excludes }
    }

    /// Resolving touches the disk, and a sleeping drive can take seconds to answer.
    pub async fn load(device_pool: &SqlitePool) -> AppResult<Self> {
        let folders = db::folders(device_pool).await?;
        tokio::task::spawn_blocking(move || Self {
            roots: resolved_folders(&folders, FolderRole::Include),
            excludes: resolved_folders(&folders, FolderRole::Exclude),
        })
        .await
        .map_err(|error| crate::errors::AppError::Internal(error.to_string()))
    }

    pub fn contains(&self, path: &Path) -> bool {
        self.roots.iter().any(|root| path.starts_with(root))
            && !self.excludes.iter().any(|folder| path.starts_with(folder))
    }

    pub fn media_file(&self, path: &Path) -> AppResult<PathBuf> {
        validate_library_file(path, &self.roots, &self.excludes, |file| {
            formats::kind_of(file).is_some()
        })
    }

    /// A file found beside a media file. A sidecar can be a link out of the folder too, so it
    /// gets the same check, and anything refused simply doesn't exist as far as the caller goes.
    pub fn sidecar(&self, path: &Path, extensions: &[&str]) -> Option<PathBuf> {
        validate_library_file(path, &self.roots, &self.excludes, |file| {
            extensions.contains(&formats::extension_of(file).as_str())
        })
        .ok()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_sidecar_that_links_out_of_the_folder_doesnt_exist() {
        let dir = std::env::temp_dir().join(format!("flow-bounds-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("music")).unwrap();
        std::fs::create_dir_all(dir.join("private")).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        let root = dir.join("music");
        let secret = dir.join("private/secret.lrc");
        std::fs::write(&secret, "x").unwrap();
        let own = root.join("own.lrc");
        std::fs::write(&own, "x").unwrap();
        let link = root.join("song.lrc");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let bounds = LibraryBounds::new(vec![root], Vec::new());
        assert_eq!(bounds.sidecar(&own, &["lrc"]), Some(own.clone()));
        assert_eq!(bounds.sidecar(&link, &["lrc"]), None);
        assert_eq!(bounds.sidecar(&own, &["srt"]), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
