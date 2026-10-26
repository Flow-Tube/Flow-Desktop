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

#[cfg(test)]
mod tests {
    use super::validate_external_url;

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
}
