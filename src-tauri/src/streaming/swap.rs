//! Keeps a video playing when googlevideo refuses one of its links mid-play (Flow for Android
//! #921). The proxy asks for the video's links again and reopens the refused byte range on the
//! identical file from whichever client still serves it, so the player never sees the refusal
//! and keeps playing from its buffer meanwhile.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use tracing::{info, warn};

/// A link to one of a video's files and the User-Agent googlevideo expects with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamLink {
    pub url: String,
    pub user_agent: String,
    pub issued_at: Instant,
}

impl StreamLink {
    #[must_use]
    pub fn new(url: String, user_agent: String) -> Self {
        Self {
            url,
            user_agent,
            issued_at: Instant::now(),
        }
    }
}

/// Fresh links for a video id, or `None` when it can't be resolved now.
pub type LinkResolver =
    Arc<dyn Fn(String) -> BoxFuture<'static, Option<Vec<StreamLink>>> + Send + Sync>;

/// Each resolve is a player request, and a video refused this often is better left to the player.
const MAX_RESOLVES_PER_VIDEO: u32 = 3;
/// Ends well inside the 10 to 25 s a wall usually leaves buffered, and inside dash.js's 20 s
/// segment timeout.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_VIDEOS: usize = 64;

/// The exact encode a googlevideo link serves. Links with the same itag, `lmt` and `clen` serve
/// byte-identical files whichever client minted them (Flow for Android measured `VISIONOS`,
/// `ANDROID_VR` and `TV_TIZEN`), so a byte range of one is the same byte range of the other.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct FileKey {
    itag: String,
    lmt: u64,
}

struct LinkFile {
    key: FileKey,
    length: Option<u64>,
}

impl LinkFile {
    fn of(url: &str) -> Option<Self> {
        let url = reqwest::Url::parse(url).ok()?;
        let value = |name: &str| {
            url.query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
        };
        Some(Self {
            key: FileKey {
                itag: value("itag").filter(|itag| !itag.is_empty())?,
                lmt: value("lmt")?.parse().ok()?,
            },
            length: value("clen").and_then(|clen| clen.parse().ok()),
        })
    }

    fn same_length(&self, other: Option<u64>) -> bool {
        self.length.is_none() || other.is_none() || self.length == other
    }
}

fn client_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "c")
                .map(|(_, value)| value.into_owned())
        })
        .unwrap_or_default()
}

#[derive(Default)]
struct VideoSwaps {
    /// Held while this video's links are being resolved, so the audio and video requests that
    /// meet the wall together share one resolve.
    resolving: Arc<tokio::sync::Mutex<()>>,
    links: HashMap<FileKey, (Option<u64>, StreamLink)>,
    resolves: u32,
    gave_up: bool,
}

#[derive(Default)]
pub struct RefusedStreamSwapper {
    resolver: OnceLock<LinkResolver>,
    videos: Mutex<HashMap<String, VideoSwaps>>,
}

impl RefusedStreamSwapper {
    pub fn set_resolver(&self, resolver: LinkResolver) {
        let _ = self.resolver.set(resolver);
    }

    /// The link that now serves `url`'s file, when an earlier refusal swapped it.
    #[must_use]
    pub fn current(&self, video_id: &str, url: &str) -> Option<StreamLink> {
        let file = LinkFile::of(url)?;
        let videos = self.videos.lock().ok()?;
        let (length, link) = videos.get(video_id)?.links.get(&file.key)?;
        (file.same_length(*length) && link.url != url).then(|| link.clone())
    }

    /// A link to the same file as the refused `url` from a fresh resolve, or `None` when there is
    /// none, which leaves the refusal to the player.
    pub async fn replace(&self, video_id: &str, url: &str) -> Option<StreamLink> {
        let refused = LinkFile::of(url)?;
        let resolver = self.resolver.get()?.clone();
        let resolving = self.video(video_id, |video| video.resolving.clone())?;
        let _resolving = resolving.lock().await;
        // The other track's request may have swapped this file while this one waited.
        if let Some(link) = self.current(video_id, url) {
            return Some(link);
        }
        let allowed = self.video(video_id, |video| {
            if video.resolves >= MAX_RESOLVES_PER_VIDEO {
                // Every segment retry lands here; one line per video keeps the log readable.
                if !std::mem::replace(&mut video.gave_up, true) {
                    warn!(
                        video_id,
                        "googlevideo keeps refusing this video's links; leaving it to the player"
                    );
                }
                return false;
            }
            video.resolves += 1;
            true
        })?;
        if !allowed {
            return None;
        }

        let links = tokio::time::timeout(RESOLVE_TIMEOUT, resolver(video_id.to_string()))
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
        let twin = links.iter().any(|link| {
            LinkFile::of(&link.url)
                .is_some_and(|file| file.key == refused.key && refused.same_length(file.length))
        });
        if !twin {
            warn!(
                video_id,
                itag = %refused.key.itag,
                from = %client_of(url),
                "googlevideo refused a link and no client serves the same file; leaving it to the player"
            );
            return None;
        }
        self.video(video_id, |video| {
            for link in links {
                if let Some(file) = LinkFile::of(&link.url) {
                    video.links.insert(file.key, (file.length, link));
                }
            }
        })?;
        let link = self.current(video_id, url)?;
        info!(
            video_id,
            itag = %refused.key.itag,
            from = %client_of(url),
            to = %client_of(&link.url),
            "googlevideo refused a link; continuing on the same file from another client"
        );
        Some(link)
    }

    fn video<T>(&self, video_id: &str, change: impl FnOnce(&mut VideoSwaps) -> T) -> Option<T> {
        let mut videos = self.videos.lock().ok()?;
        if videos.len() >= MAX_VIDEOS && !videos.contains_key(video_id) {
            videos.clear();
        }
        Some(change(videos.entry(video_id.to_string()).or_default()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn link(client: &str, itag: u32, lmt: u64, clen: u64) -> String {
        format!(
            "https://rr1.googlevideo.com/videoplayback?c={client}&itag={itag}&lmt={lmt}&clen={clen}"
        )
    }

    fn swapper(answer: Vec<String>, calls: Arc<AtomicU32>) -> RefusedStreamSwapper {
        let swapper = RefusedStreamSwapper::default();
        swapper.set_resolver(Arc::new(move |_video_id| {
            calls.fetch_add(1, Ordering::SeqCst);
            let links = answer
                .iter()
                .map(|url| StreamLink::new(url.clone(), "TV".into()))
                .collect();
            Box::pin(async move { Some(links) })
        }));
        swapper
    }

    #[tokio::test]
    async fn swaps_a_refused_link_to_the_identical_file() {
        let calls = Arc::new(AtomicU32::new(0));
        let swapper = swapper(
            vec![link("TVHTML5", 137, 7, 900), link("TVHTML5", 140, 8, 50)],
            calls.clone(),
        );
        let refused = link("VISIONOS", 137, 7, 900);
        let twin = swapper.replace("vid", &refused).await.unwrap();
        assert_eq!(twin.url, link("TVHTML5", 137, 7, 900));
        assert_eq!(twin.user_agent, "TV");
        // The audio file of the same answer is redirected before it is refused too.
        let audio = swapper
            .current("vid", &link("VISIONOS", 140, 8, 50))
            .unwrap();
        assert_eq!(audio.url, link("TVHTML5", 140, 8, 50));
        // The other track's refusal shares the resolve already made.
        assert!(swapper.replace("vid", &refused).await.is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn never_swaps_to_a_different_encode() {
        let calls = Arc::new(AtomicU32::new(0));
        let swapper = swapper(
            vec![link("TVHTML5", 137, 9, 900), link("TVHTML5", 136, 7, 400)],
            calls,
        );
        let refused = link("VISIONOS", 137, 7, 900);
        assert!(swapper.replace("vid", &refused).await.is_none());
        assert!(
            swapper
                .current("vid", &link("VISIONOS", 136, 7, 400))
                .is_none()
        );
        assert!(swapper.current("other", &refused).is_none());
    }

    #[tokio::test]
    async fn stops_resolving_a_video_that_keeps_being_refused() {
        let calls = Arc::new(AtomicU32::new(0));
        let swapper = swapper(vec![], calls.clone());
        let refused = link("VISIONOS", 137, 7, 900);
        for _ in 0..6 {
            assert!(swapper.replace("vid", &refused).await.is_none());
        }
        assert_eq!(calls.load(Ordering::SeqCst), MAX_RESOLVES_PER_VIDEO);
    }

    #[tokio::test]
    async fn a_refused_replacement_resolves_again() {
        let calls = Arc::new(AtomicU32::new(0));
        let swapper = swapper(vec![link("TVHTML5", 137, 7, 900)], calls.clone());
        let first = swapper
            .replace("vid", &link("VISIONOS", 137, 7, 900))
            .await
            .unwrap();
        // The same answer again has no other link, so the replacement's own refusal resolves anew.
        assert!(swapper.replace("vid", &first.url).await.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn does_nothing_without_a_resolver_or_a_readable_link() {
        let unwired = RefusedStreamSwapper::default();
        assert!(
            unwired
                .replace("vid", &link("VISIONOS", 137, 7, 900))
                .await
                .is_none()
        );
        let calls = Arc::new(AtomicU32::new(0));
        let swapper = swapper(vec![link("TVHTML5", 137, 7, 900)], calls.clone());
        assert!(
            swapper
                .replace("vid", "https://example.com/no-itag")
                .await
                .is_none()
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
