//! The AiSList channel filter's resident state: the list in memory, the handle index, and the
//! daily refresh. Off by default: while both switches are off nothing is read, fetched or
//! scheduled. The list is the same for every profile and never synced or backed up; the switches
//! and the allow list are ordinary profile settings.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::fetcher::HttpFetcher;
use super::formats::StoredAiList;
use super::handle;
use super::handle_index::{DEFAULT_CAPACITY, HandleIndex};
use super::matcher::{self, AiLists, AiVerdict, MatchRules};
use super::reporter::AiReportCheck;
use super::source::AiListSource;
use super::store::{AiListStorage, AiListStore, Schedule};
use super::updater::{self, AiListOutcome};
use crate::db;
use crate::services::youtube_service::YoutubeService;

/// Emitted after a refresh stored a new list, so open windows read it again.
pub const UPDATED_EVENT: &str = "ai-list://updated";

pub const KEY_BLOCK_ENABLED: &str = "ai_list_block_enabled";
pub const KEY_WARN_ENABLED: &str = "ai_list_warn_enabled";
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
    pub allowed: Vec<AllowedAiChannel>,
}

impl AiListSettings {
    #[must_use]
    pub fn is_on(&self) -> bool {
        self.block_enabled || self.warn_enabled
    }
}

/// How much of the list the computer holds, for the Settings status row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListStatus {
    pub channel_count: usize,
    pub updated_at_ms: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListRefresh {
    /// `None` when both switches are off, so nothing was asked.
    pub outcome: Option<AiListOutcome>,
    pub status: Option<AiListStatus>,
}

/// The list and what is known of channel handles, for the cards' own matcher.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListMatcherData {
    pub version: i64,
    pub block: super::formats::Entries,
    pub warn: super::formats::Entries,
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

struct Loaded {
    source_id: String,
    list: Option<Arc<StoredAiList>>,
    lists: Arc<AiLists>,
}

pub struct AiListService {
    store: AiListStore,
    loaded: RwLock<Option<Loaded>>,
    index: Mutex<Option<HandleIndex>>,
    index_read: AtomicBool,
    index_save_scheduled: AtomicBool,
    retry_delay: tokio::sync::Mutex<Duration>,
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
        }
    }

    pub async fn settings(pool: &sqlx::SqlitePool) -> AiListSettings {
        let read = |key| async move { db::settings::get_setting(pool, key).await.ok().flatten() };
        AiListSettings {
            block_enabled: read(KEY_BLOCK_ENABLED).await.as_deref() == Some("true"),
            warn_enabled: read(KEY_WARN_ENABLED).await.as_deref() == Some("true"),
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

    /// The list for `source`, read from disk the first time; `None` until one was downloaded.
    async fn lists(&self, source: &AiListSource) -> (Option<Arc<StoredAiList>>, Arc<AiLists>) {
        let source_id = source.id();
        if let Some(loaded) = self
            .loaded
            .read()
            .ok()
            .as_deref()
            .and_then(Option::as_ref)
            .filter(|loaded| loaded.source_id == source_id)
        {
            return (loaded.list.clone(), Arc::clone(&loaded.lists));
        }
        self.read_saved_index().await;
        let store = self.store.clone();
        let stored = tauri::async_runtime::spawn_blocking(move || store.load())
            .await
            .ok()
            .flatten();
        let default_id = AiListSource::default().id();
        let list = stored
            .filter(|list| list.source.as_deref().unwrap_or(&default_id) == source_id)
            .map(Arc::new);
        self.install(source_id, list)
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

    fn install(
        &self,
        source_id: String,
        list: Option<Arc<StoredAiList>>,
    ) -> (Option<Arc<StoredAiList>>, Arc<AiLists>) {
        let lists = Arc::new(list.as_deref().map(AiLists::from).unwrap_or_default());
        if let Ok(mut loaded) = self.loaded.write() {
            *loaded = Some(Loaded {
                source_id,
                list: list.clone(),
                lists: Arc::clone(&lists),
            });
        }
        (list, lists)
    }

    /// `None` while the filter is off or until a list was downloaded on this computer.
    pub async fn status(&self, pool: &sqlx::SqlitePool) -> Option<AiListStatus> {
        if !Self::settings(pool).await.is_on() {
            return None;
        }
        let (list, _) = self.lists(&Self::source(pool).await).await;
        list.as_deref().map(status_of)
    }

    pub async fn matcher_data(&self, pool: &sqlx::SqlitePool) -> Option<AiListMatcherData> {
        if !Self::settings(pool).await.is_on() {
            return None;
        }
        let (list, _) = self.lists(&Self::source(pool).await).await;
        let list = list?;
        let index = self
            .index
            .lock()
            .ok()
            .and_then(|index| index.as_ref().map(HandleIndex::pairs))
            .unwrap_or_default();
        Some(AiListMatcherData {
            version: list.version,
            block: list.block.clone(),
            warn: list.warn.clone(),
            index,
        })
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
        if !settings.is_on() {
            return vec![AiVerdict::None; channels.len()];
        }
        let (_, lists) = self.lists(&Self::source(pool).await).await;
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
        self.verdicts(&lists, &rules, channels)
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
        let (_, lists) = self.lists(&Self::source(pool).await).await;
        let listed = self.verdicts(
            &lists,
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

    /// One update run. Makes no request while both switches are off.
    pub async fn refresh(&self, app: &AppHandle, pool: &sqlx::SqlitePool) -> AiListRefresh {
        if !Self::settings(pool).await.is_on() {
            return AiListRefresh {
                outcome: None,
                status: None,
            };
        }
        let mut retry_delay = self.retry_delay.lock().await;
        let source = Self::source(pool).await;
        let (current, _) = self.lists(&source).await;
        let store = self.store.clone();
        let update = updater::run(
            &HttpFetcher::new(&source.base_url),
            &store,
            &source,
            chrono::Utc::now().timestamp_millis(),
        )
        .await;
        tracing::info!(
            outcome = ?update.outcome,
            version = ?update.list.as_ref().map(|l| l.version),
            reason = update.reason.as_deref().unwrap_or(""),
            "AI list refresh"
        );
        let mut list = current;
        let committed = update.list.filter(|_| update.outcome.committed());
        if let Some(committed) = committed
            && Self::source(pool).await == source
        {
            list = self.install(source.id(), Some(Arc::new(committed))).0;
            if let Err(error) = app.emit(UPDATED_EVENT, ()) {
                tracing::warn!(%error, "Could not announce the new AI list");
            }
        }
        let now = chrono::Utc::now().timestamp_millis();
        let next = if update.outcome == AiListOutcome::Retry {
            let wait = *retry_delay;
            *retry_delay = (wait * 2).min(MAX_RETRY);
            now + millis(wait)
        } else {
            *retry_delay = FIRST_RETRY;
            now + DAY_MS - FLEX_MS / 2 + rand::random_range(0..FLEX_MS)
        };
        self.save_schedule(next).await;
        AiListRefresh {
            outcome: Some(update.outcome),
            status: list.as_deref().map(status_of),
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

    /// A check is due when the saved time has come, or at once when nothing was ever scheduled
    /// and no list is held. A list kept from before gets its first check at a random point of the
    /// day, which spreads computers out as the list contract asks.
    async fn check_due(&self, pool: &sqlx::SqlitePool) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        let store = self.store.clone();
        let schedule = tauri::async_runtime::spawn_blocking(move || store.load_schedule())
            .await
            .ok()
            .flatten();
        if let Some(schedule) = schedule {
            return now >= schedule.next_check_at_ms;
        }
        if self.lists(&Self::source(pool).await).await.0.is_none() {
            return true;
        }
        self.save_schedule(now + rand::random_range(0..DAY_MS))
            .await;
        false
    }
}

fn status_of(list: &StoredAiList) -> AiListStatus {
    AiListStatus {
        channel_count: list.channel_count(),
        updated_at_ms: list.updated_at_ms,
        version: list.version,
    }
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

/// The daily refresh loop: about once a day while a switch is on, one manifest request that is
/// usually answered 304. Reads the switches every pass, so turning the filter on or off needs no
/// restart.
pub fn spawn(app: AppHandle, pool: sqlx::SqlitePool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            if AiListService::settings(&pool).await.is_on() {
                let service = app.state::<AiListService>();
                if service.check_due(&pool).await {
                    service.refresh(&app, &pool).await;
                }
            }
            tokio::time::sleep(LOOP_INTERVAL).await;
        }
    });
}
