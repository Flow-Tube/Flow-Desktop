pub mod core;
pub mod download;
pub mod extractors;
pub mod identity;
pub mod json;
pub mod music;
pub mod renderers;
pub mod transport;

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .tls_backend_rustls()
        .pool_idle_timeout(std::time::Duration::from_secs(120))
        .pool_max_idle_per_host(15)
        .brotli(true)
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|e| {
            tracing::error!(
                "Failed to initialize high-performance reqwest client: {}",
                e
            );
            reqwest::Client::new()
        })
}

pub struct InnertubeClient {
    pub(crate) client: reqwest::Client,
    /// A separate pool for the requests that gate first frame (`player`,
    /// `visitor_id`). Everything else multiplexes onto one HTTP/2 connection,
    /// and on a slow link the startup feed fan-out can hold that connection for
    /// minutes; a 20 KB player response queued behind it misses every
    /// per-client timeout while a fresh connection fetches it in about 2 s.
    pub(crate) playback_client: reqwest::Client,
    pub(crate) identity: identity::visitor::VisitorIdentity,
}

impl Default for InnertubeClient {
    fn default() -> Self {
        Self::new()
    }
}

impl InnertubeClient {
    #[must_use]
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
            playback_client: build_http_client(),
            identity: identity::visitor::VisitorIdentity::default(),
        }
    }

    /// Keep the visitor identity in `path` so it survives restarts.
    pub fn keep_identity_in(&self, path: std::path::PathBuf) {
        self.identity.set_file(path);
    }
}
