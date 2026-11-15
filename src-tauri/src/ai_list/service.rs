//! The AI content filter's resident state: the AiSList channel list and the AI music artist list
//! in memory, the handle index, and the daily refresh. Off by default: while every switch is off
//! nothing is read, fetched or scheduled, and each list is fetched only while its own switch is
//! on. The lists are the same for every profile and never synced or backed up; the switches and
//! the allow list are ordinary profile settings.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::fetcher::HttpFetcher;
use super::formats::{AiListKind, Entries, StoredAiList};
use super::handle;
use super::handle_index::{DEFAULT_CAPACITY, HandleIndex};
use super::matcher::{self, AiLists, AiVerdict, MatchRules};
use super::reporter::AiReportCheck;
use super::source::AiListSource;
use super::store::{AiListStorage, AiListStore, Schedule};
use super::updater::{self, AiListOutcome};
use crate::db;
use crate::services::youtube_service::YoutubeService;

/// Emitted after a refresh stored a new list, so open windows read the lists again.
pub const UPDATED_EVENT: &str = "ai-list://updated";

pub const KEY_BLOCK_ENABLED: &str = "ai_list_block_enabled";
pub const KEY_WARN_ENABLED: &str = "ai_list_warn_enabled";
pub const KEY_MUSIC_ENABLED: &str = "ai_music_block_enabled";
pub const KEY_ALLOWED: &str = "ai_list_allowed";
pub const KEY_SOURCE_URL: &str = "ai_list_source_url";
pub const KEY_SOURCE_KEY: &str = "ai_list_source_key";
pub const KEY_REPORT_NAME: &str = "ai_list_report_name";
const KEY_SUBSCRIPTIONS: &str = "subscriptions";

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// Spread of a daily check, as Android's 6-hour flex window.
const FLEX_MS: i64 = 6 * 60 * 60 * 1000;
const FIRST_RETRY: Duration = Duration::from_mins(5);
const MAX_RETRY: Duration = Duration::from_hours(6);
const STARTUP_DELAY: Duration = Duration::from_secs(30);
const LOOP_INTERVAL: Duration = Duration::from_mins(5);
/// Learned handles are written in batches; losing a few minutes of them costs nothing.
const INDEX_SAVE_DELAY: Duration = Duration::from_mins(3);

/// A channel the viewer chose to see despite the list; the name lets Settings show it offline.
#[derive(Debug, Clone, Deserialize)]
pub struct AllowedAiChannel {
    pub id: String,
    #[serde(default)]
    pub handle: Option<String>,
}

#[derive(Deserialize)]
struct StoredSubscription {
    id: String,
}

#[derive(Debug, Clone, Default)]
pub struct AiListSettings {
    pub block_enabled: bool,
    pub warn_enabled: bool,
    pub music_enabled: bool,
    pub allowed: Vec<AllowedAiChannel>,
}

impl AiListSettings {
    /// The AiSList channel list is needed.
    #[must_use]
    pub fn channels_on(&self) -> bool {
        self.block_enabled || self.warn_enabled
    }

    #[must_use]
    pub fn is_on(&self) -> bool {
        self.channels_on() || self.music_enabled
    }

    #[must_use]
    pub fn wants(&self, kind: AiListKind) -> bool {
        match kind {
            AiListKind::Channels => self.channels_on(),
            AiListKind::Music => self.music_enabled,
        }
    }
}

/// How much of each list the computer holds, for the Settings status row. A count is `None` while
/// its switch is off or until that list was downloaded here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListStatus {
    pub channel_count: Option<usize>,
    pub artist_count: Option<usize>,
    /// The latest of the lists counted.
    pub updated_at_ms: i64,
    /// The channel list's version, or the music list's when only that one is counted.
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListRefresh {
    /// `None` when every switch is off, so nothing was asked. Otherwise `retry` when any list's
    /// run asked for one, else the channel list's outcome when it ran, else the music list's.
    pub outcome: Option<AiListOutcome>,
    pub status: Option<AiListStatus>,
}

/// The lists and what is known of channel handles, for the cards' own matcher. A list whose
/// switch is off, or that was never downloaded, is sent empty with version 0.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListMatcherData {
    /// The channel list's version.
    pub version: i64,
    pub block: Entries,
    pub warn: Entries,
    /// The music list's artist ids; it has no warn side, so it can only hide.
    pub music: Entries,
    pub music_version: i64,
    /// `[channelId, normalizedHandle]`, least recently used first.
    pub index: Vec<(String, String)>,
}

/// A channel as a card or page shows it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRef {
    pub channel_id: String,
    #[serde(default)]
    pub handle: Option<String>,
}

/// The lists read for one source; a list is `None` until it was downloaded from that source.
#[derive(Clone, Default)]
struct Held {
    channels: Option<Arc<StoredAiList>>,
    music: Option<Arc<StoredAiList>>,
    /// The channel list as lookup sets, built once per stored version.
    channel_sets: Arc<AiLists>,
}

impl Held {
    fn get(&self, kind: AiListKind) -> Option<&StoredAiList> {
        match kind {
            AiListKind::Channels => self.channels.as_deref(),
            AiListKind::Music => self.music.as_deref(),
        }
    }

    fn set(&mut self, kind: AiListKind, list: Option<Arc<StoredAiList>>) {
        match kind {
            AiListKind::Channels => {
                self.channel_sets =
                    Arc::new(list.as_deref().map(AiLists::from).unwrap_or_default());
                self.channels = list;
            }
            AiListKind::Music => self.music = list,
        }
    }

    /// The channel and music lists the switches use.
    fn shown(&self, settings: &AiListSettings) -> (Option<&StoredAiList>, Option<&StoredAiList>) {
        let shown = |kind| self.get(kind).filter(|_| settings.wants(kind));
        (shown(AiListKind::Channels), shown(AiListKind::Music))
    }
}

struct Loaded {
    source_id: String,
    held: Held,
}

pub struct AiListService {
    store: AiListStore,
    loaded: RwLock<Option<Loaded>>,
    index: Mutex<Option<HandleIndex>>,
    index_read: AtomicBool,
    index_save_scheduled: AtomicBool,
    retry_delay: tokio::sync::Mutex<Duration>,
    /// Lists, by source id, a refresh asked for since the app started.
    tried: Mutex<HashSet<(AiListKind, String)>>,
}

impl AiListService {
    #[must_use]
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        Self {
            store: AiListStore::new(app_data_dir),
            loaded: RwLock::new(None),
            index: Mutex::new(None),
            index_read: AtomicBool::new(false),
            index_save_scheduled: AtomicBool::new(false),
            retry_delay: tokio::sync::Mutex::new(FIRST_RETRY),
            tried: Mutex::new(HashSet::new()),
        }
    }

    pub async fn settings(pool: &sqlx::SqlitePool) -> AiListSettings {
        let read = |key| async move { db::settings::get_setting(pool, key).await.ok().flatten() };
        AiListSettings {
            block_enabled: read(KEY_BLOCK_ENABLED).await.as_deref() == Some("true"),
            warn_enabled: read(KEY_WARN_ENABLED).await.as_deref() == Some("true"),
            music_enabled: read(KEY_MUSIC_ENABLED).await.as_deref() == Some("true"),
            allowed: read(KEY_ALLOWED)
                .await
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default(),
        }
    }

    pub async fn source(pool: &sqlx::SqlitePool) -> AiListSource {
        let url = db::settings::get_setting(pool, KEY_SOURCE_URL)
            .await
            .ok()
            .flatten();
        let key = db::settings::get_setting(pool, KEY_SOURCE_KEY)
            .await
            .ok()
            .flatten();
        AiListSource::from_settings(url.as_deref(), key.as_deref())
    }

    /// The lists for `source`, read from disk the first time. A list stored from another source
    /// is not held, so changing the source drops both until they are downloaded from it.
    async fn held(&self, source: &AiListSource) -> Held {
        let source_id = source.id();
        if let Some(loaded) = self
            .loaded
            .read()
            .ok()
            .as_deref()
            .and_then(Option::as_ref)
            .filter(|loaded| loaded.source_id == source_id)
        {
            return loaded.held.clone();
        }
        self.read_saved_index().await;
        let store = self.store.clone();
        let stored = tauri::async_runtime::spawn_blocking(move || {
            AiListKind::ALL.map(|kind| store.list(kind).load())
        })
        .await
        .unwrap_or_default();
        let default_id = AiListSource::default().id();
        let mut held = Held::default();
        for (kind, list) in AiListKind::ALL.into_iter().zip(stored) {
            let list = list
                .filter(|list| list.source.as_deref().unwrap_or(&default_id) == source_id)
                .map(Arc::new);
            held.set(kind, list);
        }
        if let Ok(mut loaded) = self.loaded.write() {
            *loaded = Some(Loaded {
                source_id,
                held: held.clone(),
            });
        }
        held
    }

    /// Reads the saved handle index once; pairs learned before it finishes win over the saved ones.
    async fn read_saved_index(&self) {
        if self.index_read.swap(true, Ordering::AcqRel) {
            return;
        }
        let store = self.store.clone();
        let saved = tauri::async_runtime::spawn_blocking(move || store.load_index())
            .await
            .unwrap_or_default();
        if let Ok(mut index) = self.index.lock() {
            let learned = index.take().map(|index| index.pairs()).unwrap_or_default();
            let mut merged = HandleIndex::from_pairs(saved, DEFAULT_CAPACITY);
            for (id, handle) in learned {
                merged.learn(&id, &handle);
            }
            *index = Some(merged);
        }
    }

    /// Holds a list just stored. When another source was read meanwhile, nothing is kept, so the
    /// next read takes both files from disk again.
    fn install(&self, source_id: &str, kind: AiListKind, list: Arc<StoredAiList>) {
        if let Ok(mut loaded) = self.loaded.write() {
            match loaded
                .as_mut()
                .filter(|loaded| loaded.source_id == source_id)
            {
                Some(loaded) => loaded.held.set(kind, Some(list)),
                None => *loaded = None,
            }
        }
    }

    /// `None` while every switch is off or until a list in use was downloaded on this computer.
    pub async fn status(&self, pool: &sqlx::SqlitePool) -> Option<AiListStatus> {
        let settings = Self::settings(pool).await;
        if !settings.is_on() {
            return None;
        }
        let held = self.held(&Self::source(pool).await).await;
        status_of(&settings, &held)
    }

    pub async fn matcher_data(&self, pool: &sqlx::SqlitePool) -> Option<AiListMatcherData> {
        let settings = Self::settings(pool).await;
        if !settings.is_on() {
            return None;
        }
        let held = self.held(&Self::source(pool).await).await;
        let index = self
            .index
            .lock()
            .ok()
            .and_then(|index| index.as_ref().map(HandleIndex::pairs))
            .unwrap_or_default();
        matcher_data_of(&settings, &held, index)
    }

    /// Records channel id and handle pairs seen outside a card, such as a channel page.
    pub fn learn(&self, app: &AppHandle, channels: &[ChannelRef]) {
        let changed = self.index.lock().is_ok_and(|mut index| {
            let index = index.get_or_insert_with(HandleIndex::default);
            let mut changed = false;
            for channel in channels {
                if !matcher::is_channel_id(&channel.channel_id) {
                    continue;
                }
                if let Some(normalized) = channel.handle.as_deref().and_then(handle::normalize) {
                    changed |= index.learn(&channel.channel_id, &normalized);
                }
            }
            changed
        });
        if changed {
            self.schedule_index_save(app);
        }
    }

    fn schedule_index_save(&self, app: &AppHandle) {
        if self.index_save_scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(INDEX_SAVE_DELAY).await;
            let service = app.state::<AiListService>();
            service.index_save_scheduled.store(false, Ordering::Release);
            // Never overwrite the saved index with only what this run learned.
            service.read_saved_index().await;
            let pairs = service
                .index
                .lock()
                .ok()
                .and_then(|index| index.as_ref().map(HandleIndex::pairs));
            let Some(pairs) = pairs else { return };
            let store = service.store.clone();
            let saved =
                tauri::async_runtime::spawn_blocking(move || store.save_index(&pairs)).await;
            if let Ok(Err(error)) = saved {
                tracing::warn!(%error, "Could not save the AI list handle index");
            }
        });
    }

    /// Each channel's verdict under the viewer's switches, allow list and subscriptions.
    pub async fn match_channels(
        &self,
        pool: &sqlx::SqlitePool,
        channels: &[ChannelRef],
    ) -> Vec<AiVerdict> {
        let settings = Self::settings(pool).await;
        // Video verdicts come from AiSList alone; the music list only hides music, which the
        // frontend matches.
        if !settings.channels_on() {
            return vec![AiVerdict::None; channels.len()];
        }
        let held = self.held(&Self::source(pool).await).await;
        let subscribed: Vec<StoredSubscription> =
            db::settings::get_setting(pool, KEY_SUBSCRIPTIONS)
                .await
                .ok()
                .flatten()
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default();
        let rules = MatchRules {
            block_enabled: settings.block_enabled,
            warn_enabled: settings.warn_enabled,
            exempt_ids: subscribed
                .into_iter()
                .map(|s| s.id)
                .chain(settings.allowed.iter().map(|a| a.id.clone()))
                .collect(),
            exempt_handles: settings
                .allowed
                .iter()
                .filter_map(|a| a.handle.as_deref().and_then(handle::normalize))
                .collect(),
        };
        self.verdicts(&held.channel_sets, &rules, channels)
    }

    fn verdicts(
        &self,
        lists: &AiLists,
        rules: &MatchRules,
        channels: &[ChannelRef],
    ) -> Vec<AiVerdict> {
        let mut guard = self.index.lock().ok();
        let mut index = guard
            .as_deref_mut()
            .map(|index| index.get_or_insert_with(HandleIndex::default));
        channels
            .iter()
            .map(|channel| {
                matcher::verdict(
                    lists,
                    rules,
                    index.as_deref_mut(),
                    &channel.channel_id,
                    channel.handle.as_deref(),
                )
            })
            .collect()
    }

    /// What a report about this channel would be: the handle to name, or why it cannot be sent.
    pub async fn check_report(
        &self,
        app: &AppHandle,
        pool: &sqlx::SqlitePool,
        channel: &ChannelRef,
    ) -> AiReportCheck {
        let name = db::settings::get_setting(pool, KEY_REPORT_NAME)
            .await
            .ok()
            .flatten();
        if name.as_deref().is_none_or(|name| name.trim().is_empty()) {
            return AiReportCheck::NoName;
        }
        let Some(handle) = report_handle(app, channel).await else {
            return AiReportCheck::NoHandle;
        };
        let held = self.held(&Self::source(pool).await).await;
        let listed = self.verdicts(
            &held.channel_sets,
            &MatchRules::listing(),
            &[ChannelRef {
                channel_id: channel.channel_id.clone(),
                handle: Some(handle.clone()),
            }],
        );
        match listed.first() {
            Some(&verdict) if verdict != AiVerdict::None => {
                AiReportCheck::AlreadyListed { verdict }
            }
            _ => AiReportCheck::Ready { handle },
        }
    }

    /// One update run of every list whose switch is on. Makes no request while every switch is
    /// off.
    pub async fn refresh(&self, app: &AppHandle, pool: &sqlx::SqlitePool) -> AiListRefresh {
        let settings = Self::settings(pool).await;
        if !settings.is_on() {
            return AiListRefresh {
                outcome: None,
                status: None,
            };
        }
        let mut retry_delay = self.retry_delay.lock().await;
        let source = Self::source(pool).await;
        let source_id = source.id();
        let mut held = self.held(&source).await;
        let fetcher = HttpFetcher::new(&source.base_url);
        let mut outcomes = Vec::new();
        let mut changed = false;
        for kind in AiListKind::ALL
            .into_iter()
            .filter(|&kind| settings.wants(kind))
        {
            let update = updater::run(
                &fetcher,
                &self.store.list(kind),
                &source,
                kind,
                chrono::Utc::now().timestamp_millis(),
            )
            .await;
            tracing::info!(
                list = kind.id(),
                outcome = ?update.outcome,
                version = ?update.list.as_ref().map(|l| l.version),
                reason = update.reason.as_deref().unwrap_or(""),
                "AI list refresh"
            );
            if let Ok(mut tried) = self.tried.lock() {
                tried.insert((kind, source_id.clone()));
            }
            let committed = update.list.filter(|_| update.outcome.committed());
            if let Some(committed) = committed
                && Self::source(pool).await == source
            {
                let committed = Arc::new(committed);
                self.install(&source_id, kind, Arc::clone(&committed));
                held.set(kind, Some(committed));
                changed = true;
            }
            outcomes.push(update.outcome);
        }
        if changed && let Err(error) = app.emit(UPDATED_EVENT, ()) {
            tracing::warn!(%error, "Could not announce the new AI list");
        }
        // `is_on` means at least one list ran.
        let outcome = if outcomes.contains(&AiListOutcome::Retry) {
            AiListOutcome::Retry
        } else {
            outcomes[0]
        };
        let now = chrono::Utc::now().timestamp_millis();
        let next = if outcome == AiListOutcome::Retry {
            let wait = *retry_delay;
            *retry_delay = (wait * 2).min(MAX_RETRY);
            now + millis(wait)
        } else {
            *retry_delay = FIRST_RETRY;
            now + DAY_MS - FLEX_MS / 2 + rand::random_range(0..FLEX_MS)
        };
        self.save_schedule(next).await;
        AiListRefresh {
            outcome: Some(outcome),
            status: status_of(&settings, &held),
        }
    }

    async fn save_schedule(&self, next_check_at_ms: i64) {
        let store = self.store.clone();
        let saved = tauri::async_runtime::spawn_blocking(move || {
            store.save_schedule(Schedule { next_check_at_ms })
        })
        .await;
        if let Ok(Err(error)) = saved {
            tracing::warn!(%error, "Could not save the AI list schedule");
        }
    }

    /// A check is due when the saved time has come, or at once when a switched-on list was never
    /// downloaded from this source and not asked for since the app started: at start, when its
    /// switch is turned on, or after the source changed. Lists kept from before with nothing
    /// scheduled get their first check at a random point of the day, which spreads computers out
    /// as the list contract asks.
    async fn check_due(&self, pool: &sqlx::SqlitePool, settings: &AiListSettings) -> bool {
        let source = Self::source(pool).await;
        let source_id = source.id();
        let held = self.held(&source).await;
        let untried = self.tried.lock().is_ok_and(|tried| {
            AiListKind::ALL.into_iter().any(|kind| {
                settings.wants(kind)
                    && held.get(kind).is_none()
                    && !tried.contains(&(kind, source_id.clone()))
            })
        });
        if untried {
            return true;
        }
        let now = chrono::Utc::now().timestamp_millis();
        let store = self.store.clone();
        let schedule = tauri::async_runtime::spawn_blocking(move || store.load_schedule())
            .await
            .ok()
            .flatten();
        if let Some(schedule) = schedule {
            return now >= schedule.next_check_at_ms;
        }
        self.save_schedule(now + rand::random_range(0..DAY_MS))
            .await;
        false
    }
}

fn status_of(settings: &AiListSettings, held: &Held) -> Option<AiListStatus> {
    let (channels, music) = held.shown(settings);
    let updated_at_ms = channels
        .into_iter()
        .chain(music)
        .map(|list| list.updated_at_ms)
        .max()?;
    Some(AiListStatus {
        channel_count: channels.map(StoredAiList::channel_count),
        artist_count: music.map(StoredAiList::artist_count),
        updated_at_ms,
        version: channels.or(music)?.version,
    })
}

/// `None` until a list in use was downloaded.
fn matcher_data_of(
    settings: &AiListSettings,
    held: &Held,
    index: Vec<(String, String)>,
) -> Option<AiListMatcherData> {
    let (channels, music) = held.shown(settings);
    if channels.is_none() && music.is_none() {
        return None;
    }
    Some(AiListMatcherData {
        version: channels.map_or(0, |list| list.version),
        block: channels.map(|list| list.block.clone()).unwrap_or_default(),
        warn: channels.map(|list| list.warn.clone()).unwrap_or_default(),
        music: Entries {
            handles: Vec::new(),
            ids: music.map(|list| list.block.ids.clone()).unwrap_or_default(),
        },
        music_version: music.map_or(0, |list| list.version),
        index,
    })
}

fn millis(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

/// The card's handle when it had one, otherwise the channel page's.
async fn report_handle(app: &AppHandle, channel: &ChannelRef) -> Option<String> {
    if let Some(handle) = channel.handle.as_deref().and_then(handle::for_report) {
        return Some(handle);
    }
    if channel.channel_id.starts_with('@') {
        return handle::for_report(&channel.channel_id);
    }
    if !channel.channel_id.starts_with("UC") {
        return None;
    }
    let youtube = app.try_state::<YoutubeService>()?;
    let details = youtube
        .get_channel_details(&channel.channel_id)
        .await
        .ok()?;
    details.handle.as_deref().and_then(handle::for_report)
}

/// The daily refresh loop: about once a day while a switch is on, one manifest request per list
/// in use that is usually answered 304. Reads the switches every pass, so turning a list on or off
/// needs no restart.
pub fn spawn(app: AppHandle, pool: sqlx::SqlitePool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            let settings = AiListService::settings(&pool).await;
            if settings.is_on() {
                let service = app.state::<AiListService>();
                if service.check_due(&pool, &settings).await {
                    service.refresh(&app, &pool).await;
                }
            }
            tokio::time::sleep(LOOP_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTED: &str = "UCdddddddddddddddddddddd";
    const ARTIST: &str = "UCaaaaaaaaaaaaaaaaaaaaaa";

    fn list(version: i64, updated_at_ms: i64, handles: &[&str], ids: &[&str]) -> Arc<StoredAiList> {
        let strings = |values: &[&str]| values.iter().map(ToString::to_string).collect();
        Arc::new(StoredAiList {
            version,
            updated_at_ms,
            block: Entries {
                handles: strings(handles),
                ids: strings(ids),
            },
            ..StoredAiList::default()
        })
    }

    fn held() -> Held {
        let mut held = Held::default();
        held.set(
            AiListKind::Channels,
            Some(list(7, 10, &["drew"], &[LISTED])),
        );
        held.set(AiListKind::Music, Some(list(3, 20, &[], &[ARTIST, "UCb"])));
        held
    }

    fn switches(block: bool, music: bool) -> AiListSettings {
        AiListSettings {
            block_enabled: block,
            music_enabled: music,
            ..AiListSettings::default()
        }
    }

    #[test]
    fn the_status_counts_only_the_lists_switched_on() {
        let both = status_of(&switches(true, true), &held()).unwrap();
        assert_eq!(both.channel_count, Some(1));
        assert_eq!(both.artist_count, Some(2));
        assert_eq!(both.updated_at_ms, 20);
        assert_eq!(both.version, 7);

        let music = status_of(&switches(false, true), &held()).unwrap();
        assert_eq!(music.channel_count, None);
        assert_eq!(music.artist_count, Some(2));
        assert_eq!(music.version, 3);

        let channels = status_of(&switches(true, false), &held()).unwrap();
        assert_eq!(channels.artist_count, None);
        assert_eq!(channels.updated_at_ms, 10);

        let mut only_music = Held::default();
        only_music.set(AiListKind::Music, held().music);
        assert!(status_of(&switches(true, false), &only_music).is_none());
    }

    #[test]
    fn the_matcher_data_sends_the_music_ids_only_while_its_switch_is_on() {
        let data = matcher_data_of(&switches(true, true), &held(), Vec::new()).unwrap();
        assert_eq!(data.version, 7);
        assert_eq!(data.block.ids, vec![LISTED.to_string()]);
        assert_eq!(data.music.ids, vec![ARTIST.to_string(), "UCb".to_string()]);
        assert_eq!(data.music_version, 3);

        let channels = matcher_data_of(&switches(true, false), &held(), Vec::new()).unwrap();
        assert_eq!(channels.music, Entries::default());
        assert_eq!(channels.music_version, 0);

        let music = matcher_data_of(&switches(false, true), &held(), Vec::new()).unwrap();
        assert_eq!(music.block, Entries::default());
        assert_eq!(music.version, 0);

        assert!(matcher_data_of(&switches(true, true), &Held::default(), Vec::new()).is_none());
    }

    #[test]
    fn video_verdicts_never_use_the_music_list() {
        let service = AiListService::new(&std::env::temp_dir());
        let verdicts = service.verdicts(
            &held().channel_sets,
            &MatchRules::listing(),
            &[
                ChannelRef {
                    channel_id: ARTIST.to_string(),
                    handle: None,
                },
                ChannelRef {
                    channel_id: LISTED.to_string(),
                    handle: None,
                },
            ],
        );
        assert_eq!(verdicts, vec![AiVerdict::None, AiVerdict::Block]);
    }

    #[test]
    fn each_switch_wants_its_own_list() {
        let warn = AiListSettings {
            warn_enabled: true,
            ..AiListSettings::default()
        };
        assert!(warn.wants(AiListKind::Channels) && !warn.wants(AiListKind::Music));
        let music = switches(false, true);
        assert!(music.is_on() && !music.channels_on() && music.wants(AiListKind::Music));
        assert!(!AiListSettings::default().is_on());
    }
}
