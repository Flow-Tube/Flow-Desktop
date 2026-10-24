//! The HTTPS passthrough the client-side lyrics engine uses: the lyrics providers are external
//! services the webview cannot reach because of CORS, so their requests come through here,
//! limited to their hosts and bounded in time and size.

use std::time::Duration;

use reqwest::Url;

use crate::errors::AppError;

/// One provider's budget on the frontend, so an abandoned lookup ends with it.
pub const LYRICS_HTTP_TIMEOUT: Duration = Duration::from_secs(8);

/// Lyrics documents are small; the largest legitimate body is Apple's web player script, which
/// Paxsenix reads its catalogue token from.
pub const LYRICS_HTTP_MAX_BODY: usize = 8 * 1024 * 1024;

/// Hosts of the lyrics providers: `BetterLyrics`, lrc.red, `LyricsPlus`, `SimpMusic`, `KuGou`,
/// `Paxsenix` (with the Apple Music catalogue and iTunes search it looks songs up in), `LrcLib`
/// and Unison.
const LYRICS_HOSTS: &[&str] = &[
    "lyrics-api.boidu.dev",
    "lrc.red",
    "lyricsplus.binimum.org",
    "api-lyrics.simpmusic.org",
    "mobileservice.kugou.com",
    "lyrics.kugou.com",
    "lyrics.paxsenix.org",
    "beta.music.apple.com",
    "amp-api.music.apple.com",
    "itunes.apple.com",
    "lrclib.net",
    "unison.boidu.dev",
];

pub struct LyricsHttpBody {
    pub status: u16,
    pub body: String,
}

/// True for an https URL on a lyrics provider's host (or a subdomain of one).
#[must_use]
pub fn is_lyrics_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    LYRICS_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

fn parse_lyrics_url(raw: &str) -> Result<Url, AppError> {
    let url = Url::parse(raw).map_err(|_| AppError::Validation("Invalid lyrics URL".into()))?;
    if is_lyrics_url(&url) {
        Ok(url)
    } else {
        Err(AppError::Validation(
            "Lyrics requests may only go to a lyrics provider over https".into(),
        ))
    }
}

pub async fn get(
    raw_url: &str,
    headers: impl IntoIterator<Item = (String, String)>,
) -> Result<LyricsHttpBody, AppError> {
    let url = parse_lyrics_url(raw_url)?;
    let mut req = crate::api::http::shared_client()
        .get(url)
        .timeout(LYRICS_HTTP_TIMEOUT);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let mut resp = req
        .send()
        .await
        .map_err(|e| AppError::Extractor(e.to_string()))?;
    // The shared client follows redirects, so the host is checked again where it ended up.
    if !is_lyrics_url(resp.url()) {
        return Err(AppError::Validation(
            "A lyrics provider redirected outside the lyrics providers".into(),
        ));
    }
    let status = resp.status().as_u16();
    if resp
        .content_length()
        .is_some_and(|len| len > LYRICS_HTTP_MAX_BODY as u64)
    {
        return Err(AppError::Extractor("Lyrics response too large".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Extractor(e.to_string()))?
    {
        if bytes.len() + chunk.len() > LYRICS_HTTP_MAX_BODY {
            return Err(AppError::Extractor("Lyrics response too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(LyricsHttpBody {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(raw: &str) -> bool {
        parse_lyrics_url(raw).is_ok()
    }

    #[test]
    fn provider_hosts_over_https_are_allowed() {
        assert!(allowed("https://lyrics-api.boidu.dev/getLyrics?s=a&a=b"));
        assert!(allowed("https://lrc.red/api/v1?track=a"));
        assert!(allowed("https://cdn.lrc.red/s/XX.ttml"));
        assert!(allowed("https://itunes.apple.com/search?term=a"));
        assert!(allowed("https://LRCLIB.net/api/get"));
    }

    #[test]
    fn other_hosts_and_plain_http_are_refused() {
        assert!(!allowed("http://lrclib.net/api/get"));
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("https://lrclib.net.example.com/"));
        assert!(!allowed("https://evillrclib.net/"));
        assert!(!allowed("https://127.0.0.1/"));
        assert!(!allowed("not a url"));
    }
}
