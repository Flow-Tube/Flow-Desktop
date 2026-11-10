use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

pub fn validate_search_query(query: &str) -> AppResult<()> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        return Err(AppError::Validation("Search query cannot be empty".into()));
    }

    if trimmed.chars().count() > 200 {
        return Err(AppError::Validation(
            "Search query cannot exceed 200 characters".into(),
        ));
    }

    Ok(())
}

pub fn validate_video_id(video_id: &str) -> AppResult<()> {
    let trimmed = video_id.trim();

    if trimmed.len() != 11 {
        return Err(AppError::Validation("Invalid YouTube video ID".into()));
    }

    let is_valid = trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-');

    if !is_valid {
        return Err(AppError::Validation("Invalid YouTube video ID".into()));
    }

    Ok(())
}

pub fn validate_playlist_id(playlist_id: &str) -> AppResult<()> {
    let trimmed = playlist_id.trim();

    if !(10..=64).contains(&trimmed.len()) {
        return Err(AppError::Validation("Invalid playlist ID length".into()));
    }

    let is_valid = trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-');

    if !is_valid {
        return Err(AppError::Validation("Invalid playlist ID".into()));
    }

    Ok(())
}

pub fn validate_channel_id(channel_id: &str) -> AppResult<()> {
    let trimmed = channel_id.trim();

    if trimmed.is_empty() {
        return Err(AppError::Validation("Channel ID cannot be empty".into()));
    }

    if trimmed.chars().count() > 100 {
        return Err(AppError::Validation(
            "Channel ID cannot exceed 100 characters".into(),
        ));
    }

    Ok(())
}

pub fn validate_page_token(page_token: &str) -> AppResult<()> {
    let trimmed = page_token.trim();

    if trimmed.is_empty() {
        return Err(AppError::Validation("Page token cannot be empty".into()));
    }

    if trimmed.chars().count() > 16384 {
        return Err(AppError::Validation(
            "Page token cannot exceed 16384 characters".into(),
        ));
    }

    Ok(())
}

pub fn validate_browse_id(id: &str) -> AppResult<()> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("ID parameter cannot be empty".into()));
    }
    // Check against path traversal or malicious characters
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('.')
        || trimmed.contains(':')
    {
        return Err(AppError::Validation("Malformed ID format detected".into()));
    }
    // Verify prefix structure or alphanumeric + underscore/dash characters
    if trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '%')
    {
        Ok(())
    } else {
        Err(AppError::Validation(
            "Invalid character set in ID parameter".into(),
        ))
    }
}

/// Links Flow hands to the system to open: web pages and mail only, never a
/// file, a script or another app's scheme.
pub fn validate_external_url(url: &str) -> AppResult<()> {
    let parsed =
        reqwest::Url::parse(url.trim()).map_err(|_| AppError::Validation("Invalid link".into()))?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some_and(|host| !host.is_empty()) => Ok(()),
        "mailto" => Ok(()),
        _ => Err(AppError::Validation(
            "Only web and mail links can be opened".into(),
        )),
    }
}

/// A page inside Flow that a new window opens on: an app path such as
/// `/watch/<id>`, never a URL that could point the window somewhere else.
pub fn validate_app_route(route: &str) -> AppResult<()> {
    let valid = route.len() <= 2048
        && route.starts_with('/')
        && !route.starts_with("//")
        && !route.contains('\\')
        && !route.chars().any(char::is_control);
    if valid {
        Ok(())
    } else {
        Err(AppError::Validation("Invalid page for a new window".into()))
    }
}

/// Hosts Flow opens links from, the same ones `src/lib/youtubeUrl.ts` reads.
const LINK_DOMAINS: [&str; 5] = [
    "youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
    "piped.video",
    "yewtu.be",
];
const MAX_LINK_CHARS: usize = 2048;

/// Whether a link from outside Flow, such as a command-line argument, is one to open at all.
/// The frontend then decides what it points at, and ignores anything else.
pub fn is_openable_link(link: &str) -> bool {
    if link.len() > MAX_LINK_CHARS || link.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(link) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            let host = host.to_ascii_lowercase();
            LINK_DOMAINS
                .iter()
                .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        })
}

/// A folder someone chose for the library, resolved. The root of a drive is refused: walking and
/// serving a whole system is never what picking a music folder means.
pub fn validate_library_folder(path: &Path) -> AppResult<PathBuf> {
    let resolved = std::fs::canonicalize(path)
        .map_err(|_| AppError::Validation("That folder can't be read".into()))?;
    if !resolved.is_dir() {
        return Err(AppError::Validation("That isn't a folder".into()));
    }
    if resolved.parent().is_none() {
        return Err(AppError::Validation(
            "Choose a folder inside the drive, not the whole drive".into(),
        ));
    }
    Ok(resolved)
}

/// Where a library file really is, once links are resolved, and only if that is still inside a
/// chosen folder and outside the excluded ones. Everything the webview is served from the
/// library goes through this, so a file swapped for a link can't reach anything else.
pub fn validate_library_file(
    path: &Path,
    roots: &[PathBuf],
    excludes: &[PathBuf],
    is_allowed_type: impl Fn(&Path) -> bool,
) -> AppResult<PathBuf> {
    let resolved = std::fs::canonicalize(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::LocalFileMissing("The file is no longer in that folder".into())
        } else {
            AppError::LocalFileRefused("The file can't be read".into())
        }
    })?;
    let inside = roots.iter().any(|root| resolved.starts_with(root));
    let left_out = excludes.iter().any(|folder| resolved.starts_with(folder));
    if !inside || left_out {
        return Err(AppError::LocalFileRefused(
            "The file is outside your library folders".into(),
        ));
    }
    if !resolved.is_file() || !is_allowed_type(&resolved) {
        return Err(AppError::LocalFileRefused(
            "That isn't a file Flow can open".into(),
        ));
    }
    Ok(resolved)
}

pub fn validate_local_media_id(id: &str) -> AppResult<()> {
    if crate::local_media::is_local_id(id) {
        Ok(())
    } else {
        Err(AppError::Validation("Invalid local file ID".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_openable_link, validate_app_route, validate_external_url, validate_library_file,
        validate_library_folder, validate_local_media_id,
    };
    use crate::errors::AppResult;
    use std::path::{Path, PathBuf};

    #[test]
    fn only_youtube_and_its_front_ends_are_openable_links() {
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc",
            "http://youtu.be/dQw4w9WgXcQ",
            "https://music.youtube.com/browse/MPREb_abc",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://piped.video/watch?v=dQw4w9WgXcQ",
            "https://yewtu.be/watch?v=dQw4w9WgXcQ",
        ] {
            assert!(is_openable_link(link), "{link}");
        }
        for link in [
            "https://evil.example/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch",
            "https://notyoutube.com/watch",
            "https://www.youtube.com@evil.example/watch",
            "https://user:pass@youtube.com/watch",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "flow://watch?v=dQw4w9WgXcQ",
            "youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/a b",
            "https://youtube.com/a\nb",
            "--new-window",
            "",
        ] {
            assert!(!is_openable_link(link), "{link}");
        }
        assert!(!is_openable_link(&format!(
            "https://youtube.com/{}",
            "a".repeat(2048)
        )));
    }

    #[test]
    fn app_routes_stay_inside_flow() {
        assert!(validate_app_route("/").is_ok());
        assert!(validate_app_route("/watch/dQw4w9WgXcQ?t=42").is_ok());
        assert!(validate_app_route("/search?q=lofi%20beats").is_ok());
        for route in [
            "",
            "watch/abc",
            "//evil.example",
            "/\\evil.example",
            "https://evil.example",
            "/watch/a\nb",
        ] {
            assert!(
                validate_app_route(route).is_err(),
                "{route:?} should be rejected"
            );
        }
        assert!(validate_app_route(&format!("/{}", "a".repeat(2048))).is_err());
    }

    #[test]
    fn web_and_mail_links_open() {
        assert!(validate_external_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").is_ok());
        assert!(validate_external_url("http://example.com").is_ok());
        assert!(validate_external_url("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn files_scripts_and_other_schemes_do_not() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "smb://server/share",
            "flow://watch?v=x",
            "https://",
            "not a url",
            "",
        ] {
            assert!(validate_external_url(url).is_err(), "{url}");
        }
    }

    struct Library {
        dir: PathBuf,
        root: PathBuf,
    }

    impl Library {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("flow-lib-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("music")).unwrap();
            let resolved = std::fs::canonicalize(dir).unwrap();
            let root = resolved.join("music");
            Self {
                dir: resolved,
                root,
            }
        }

        fn write(&self, relative: &str) -> PathBuf {
            let path = self.dir.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"x").unwrap();
            path
        }

        fn check(&self, path: &Path, excludes: &[PathBuf]) -> AppResult<PathBuf> {
            validate_library_file(path, std::slice::from_ref(&self.root), excludes, |file| {
                crate::local_media::formats::kind_of(file).is_some()
            })
        }
    }

    impl Drop for Library {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn kind_of(result: AppResult<PathBuf>) -> String {
        crate::errors::ErrorResponse::from(result.unwrap_err()).kind
    }

    #[test]
    fn a_library_file_inside_a_chosen_folder_is_served() {
        let library = Library::new();
        let song = library.write("music/album/song.mp3");
        assert_eq!(library.check(&song, &[]).unwrap(), song);
    }

    #[test]
    fn a_sibling_with_the_same_prefix_is_outside() {
        let library = Library::new();
        let other = library.write("music-private/song.mp3");
        assert_eq!(kind_of(library.check(&other, &[])), "localFileRefused");
    }

    #[test]
    fn parent_steps_cant_climb_out() {
        let library = Library::new();
        library.write("private/song.mp3");
        let climbing = library.root.join("../private/song.mp3");
        assert_eq!(kind_of(library.check(&climbing, &[])), "localFileRefused");
    }

    #[test]
    fn an_excluded_folder_is_refused() {
        let library = Library::new();
        let song = library.write("music/hidden/song.mp3");
        let excludes = [library.root.join("hidden")];
        assert_eq!(kind_of(library.check(&song, &excludes)), "localFileRefused");
    }

    #[test]
    fn only_media_files_are_served() {
        let library = Library::new();
        let key = library.write("music/id_rsa");
        assert_eq!(kind_of(library.check(&key, &[])), "localFileRefused");
        assert_eq!(
            kind_of(library.check(&library.root, &[])),
            "localFileRefused"
        );
    }

    #[test]
    fn a_file_that_went_away_says_so() {
        let library = Library::new();
        let gone = library.root.join("gone.mp3");
        assert_eq!(kind_of(library.check(&gone, &[])), "localFileMissing");
    }

    #[cfg(unix)]
    #[test]
    fn a_file_swapped_for_a_link_out_is_refused() {
        let library = Library::new();
        let secret = library.write("private/secret.mp3");
        let link = library.root.join("innocent.mp3");
        std::os::unix::fs::symlink(secret, &link).unwrap();
        assert_eq!(kind_of(library.check(&link, &[])), "localFileRefused");
    }

    #[test]
    fn the_root_of_a_drive_cant_be_a_library_folder() {
        let library = Library::new();
        assert_eq!(
            validate_library_folder(&library.root).unwrap(),
            library.root
        );
        assert!(validate_library_folder(Path::new("/")).is_err());
        assert!(validate_library_folder(&library.root.join("missing")).is_err());
        let file = library.write("music/file.mp3");
        assert!(validate_library_folder(&file).is_err());
    }

    #[test]
    fn a_local_id_must_have_the_exact_shape() {
        assert!(validate_local_media_id("local_0123456789abcdef").is_ok());
        assert!(validate_local_media_id("/etc/passwd").is_err());
        assert!(validate_local_media_id("dQw4w9WgXcQ").is_err());
    }
}
