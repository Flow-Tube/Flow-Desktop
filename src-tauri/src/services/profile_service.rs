//! Creating, editing and deleting profiles. Everything here works on closed files: a new
//! profile's database is created and filled from the running process, and a deleted profile is
//! never the one in use, so nothing waits for a restart.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::sync::Mutex;

use crate::errors::{AppError, AppResult};
use crate::profiles::registry::{self, Profile, ProfileAvatar, RegistryState};
use crate::profiles::{ActiveProfile, device_keys, local_state, photos};
use crate::scrobble::credentials::{self, Keychain, ProfileScoped};

/// Library rows a new profile can take: channels and groups (contract part SUBSCRIPTIONS).
const SUBSCRIPTION_KEYS: [&str; 3] = [
    "subscriptions",
    "subscription_groups",
    "subscription_notifications",
];

/// Both engines with blocked and preferred topics, channels and artists (part RECOMMENDATIONS).
const RECOMMENDATION_KEYS: [&str; 6] = [
    "user_neuro_brain",
    "user_music_brain",
    "music_brain_backfilled",
    "feed_actions_state_v1",
    "music_actions_state_v1",
    "blocked_channel_names",
];

/// Never copied as a setting: library data (history, likes and playlists are never copied),
/// engine and sync state, and the profile's in-progress state.
const NEVER_COPIED_AS_SETTINGS: [&str; 14] = [
    "liked_items",
    "user_playlists",
    "saved_albums",
    "saved_shorts_library",
    "subscription_tombstones",
    "user_neuro_brain_before_v14",
    "deep_flow_active",
    "deep_flow_activated_at",
    "tab_session",
    "sponsorblock_user_id",
    "sponsorblock_saved_minutes",
    "sponsorblock_saved_seconds",
    "sponsorblock_skipped_segments",
    "blocked_reveal_pin",
];

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CopyParts {
    /// Profile setting keys to copy; the frontend knows which settings are preferences.
    pub settings: Vec<String>,
    pub subscriptions: bool,
    pub recommendations: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProfile {
    pub name: String,
    pub color_key: String,
    pub avatar: ProfileAvatar,
    #[serde(default)]
    pub copy: CopyParts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesView {
    pub profiles: Vec<Profile>,
    /// `data:` URLs of the photo avatars, by profile id.
    pub photos: std::collections::HashMap<String, String>,
    pub default_id: String,
    pub active_id: String,
    pub max_profiles: usize,
}

pub struct ProfileService {
    app_data_dir: PathBuf,
    running: ActiveProfile,
    edits: Mutex<()>,
    /// The profile a committed switch is heading to.
    switching: std::sync::Mutex<Option<String>>,
    /// Removes a deleted profile's scrobbling item; tests swap it so they never touch the
    /// real keychain.
    forget_keychain_item: fn(&str) -> bool,
}

impl ProfileService {
    pub fn new(app_data_dir: PathBuf, running: ActiveProfile) -> Self {
        Self {
            app_data_dir,
            running,
            edits: Mutex::new(()),
            switching: std::sync::Mutex::new(None),
            forget_keychain_item: forget_in_keychain,
        }
    }

    fn load(&self) -> AppResult<RegistryState> {
        Ok(registry::load(&self.app_data_dir)?)
    }

    fn save(&self, state: &RegistryState) -> AppResult<()> {
        Ok(registry::save(&self.app_data_dir, state)?)
    }

    fn profile_dir(&self, id: &str) -> AppResult<PathBuf> {
        profile_dir(&self.app_data_dir, id)
    }

    pub fn list(&self) -> AppResult<ProfilesView> {
        let state = self.load()?;
        let photos = state
            .profiles
            .iter()
            .filter(|profile| profile.avatar.kind == "photo")
            .filter_map(|profile| {
                photos::data_url(&self.app_data_dir, &profile.id)
                    .map(|url| (profile.id.clone(), url))
            })
            .collect();
        Ok(ProfilesView {
            photos,
            default_id: state.default_id().to_string(),
            // The process runs as one profile for its whole life, even if the registry already
            // names the next one during a switch.
            active_id: self.running_id(&state),
            profiles: state.profiles,
            max_profiles: registry::MAX_PROFILES,
        })
    }

    /// A locked keychain must not stop a delete; the item is retried at the next start.
    async fn forget_keychain_item(&self, id: String) {
        let forget = self.forget_keychain_item;
        let removed = tokio::task::spawn_blocking({
            let id = id.clone();
            move || forget(&id)
        })
        .await;
        if !matches!(removed, Ok(true)) {
            tracing::warn!(profile = %id, "scrobbling keychain item not removed; retrying at next start");
            local_state::update(&self.app_data_dir, |state| {
                if !state.keychain_deletes.contains(&id) {
                    state.keychain_deletes.push(id);
                }
            });
        }
    }

    fn running_id(&self, state: &RegistryState) -> String {
        if self.running.is_default {
            state.default_id().to_string()
        } else {
            self.running.id.clone()
        }
    }

    /// Creates the profile's database, copies the ticked parts from the running profile, and
    /// only then lists it, so a failure leaves nothing behind.
    pub async fn create(&self, pool: &SqlitePool, request: NewProfile) -> AppResult<Profile> {
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        if state.profiles.len() >= registry::MAX_PROFILES {
            return Err(AppError::ProfileLimit(registry::MAX_PROFILES));
        }
        let name = valid_name(&state, None, &request.name, false)?;
        let mut profile = Profile::new(registry::new_id(), registry::now_ms());
        profile.name = name;
        profile.color_key = valid_color(&request.color_key)?;
        profile.avatar = valid_new_avatar(request.avatar)?;

        let dir = self.profile_dir(&profile.id)?;
        if let Err(error) = fill_new_database(pool, &dir, &request.copy).await {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(AppError::ProfileCopyFailed(error.to_string()));
        }
        state.profiles.push(profile.clone());
        if let Err(error) = self.save(&state) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(error);
        }
        tracing::info!(profile = %profile.id, "profile created");
        Ok(profile)
    }

    pub async fn rename(&self, id: &str, name: &str) -> AppResult<Profile> {
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        let is_default = id == state.default_id();
        let name = valid_name(&state, Some(id), name, is_default)?;
        let profile = find_mut(&mut state, id)?;
        profile.name = name;
        let updated = profile.clone();
        self.save(&state)?;
        Ok(updated)
    }

    pub async fn set_look(
        &self,
        id: &str,
        color_key: &str,
        avatar: ProfileAvatar,
    ) -> AppResult<Profile> {
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        let color_key = valid_color(color_key)?;
        let profile = find_mut(&mut state, id)?;
        let photo_version = profile.avatar.photo_version;
        let mut avatar = valid_new_avatar(avatar)?;
        // A photo is set through its own command; changing the colour keeps it.
        if profile.avatar.kind == "photo" && avatar.kind == "photo" {
            avatar.photo_version = photo_version;
        }
        let drops_photo = profile.avatar.kind == "photo" && avatar.kind != "photo";
        profile.color_key = color_key;
        profile.avatar = avatar;
        let updated = profile.clone();
        self.save(&state)?;
        if drops_photo && let Err(error) = photos::remove(&self.app_data_dir, id) {
            tracing::warn!(profile = %id, %error, "could not remove a profile photo");
        }
        Ok(updated)
    }

    /// Makes a picture the profile's avatar.
    pub async fn set_photo(&self, id: &str, source: PathBuf) -> AppResult<Profile> {
        let size = tokio::fs::metadata(&source).await?.len();
        if size > photos::MAX_INPUT_BYTES {
            return Err(AppError::ProfilePhotoInvalid("tooLarge".into()));
        }
        let bytes = tokio::fs::read(&source).await?;
        let webp = tokio::task::spawn_blocking(move || photos::encode(&bytes))
            .await
            .map_err(|error| AppError::Internal(error.to_string()))??;
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        let profile = find_mut(&mut state, id)?;
        photos::save(&self.app_data_dir, id, &webp)?;
        profile.avatar = ProfileAvatar {
            kind: "photo".into(),
            emoji: profile.avatar.emoji.clone(),
            photo_version: registry::now_ms(),
        };
        let updated = profile.clone();
        self.save(&state)?;
        Ok(updated)
    }

    /// Commits to a switch: from here links are held for the next process and the windows
    /// save their work. Refused while sync runs, during another switch, or for the running
    /// profile.
    pub fn prepare_switch(&self, id: &str, sync_busy: bool) -> AppResult<()> {
        let state = self.load()?;
        if state.profiles.iter().all(|profile| profile.id != id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        if id == self.running_id(&state) {
            return Err(AppError::ProfileSwitchRefused("alreadyActive"));
        }
        if sync_busy {
            return Err(AppError::ProfileSwitchRefused("syncRunning"));
        }
        let mut switching = self.switching.lock().expect("switch lock");
        if switching.is_some() {
            return Err(AppError::ProfileSwitchRefused("switching"));
        }
        *switching = Some(id.to_string());
        Ok(())
    }

    pub fn cancel_switch(&self) {
        *self.switching.lock().expect("switch lock") = None;
    }

    pub fn is_switching(&self) -> bool {
        self.switching.lock().expect("switch lock").is_some()
    }

    /// The running profile's id (Default's id when the registry couldn't be read at start).
    pub fn running_profile_id(&self) -> AppResult<String> {
        Ok(self.running_id(&self.load()?))
    }

    /// Opens a profile that isn't running. Default's file is the app data folder's own.
    pub async fn open_closed(&self, id: &str) -> AppResult<(SqlitePool, bool)> {
        let state = self.load()?;
        if state.profiles.iter().all(|profile| profile.id != id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        let is_default = id == state.default_id();
        let dir = if is_default {
            self.app_data_dir.clone()
        } else {
            self.profile_dir(id)?
        };
        Ok((crate::db::open_closed_profile(dir).await?, is_default))
    }

    /// Keeps a link that arrived during a switch for the next process; the latest one wins.
    /// Returns false when no switch is under way, so the caller opens it itself.
    pub fn hold_link(&self, url: &str) -> bool {
        if !self.is_switching() {
            return false;
        }
        let url = url.to_string();
        local_state::update(&self.app_data_dir, |state| {
            state.pending_handoff = Some(url)
        });
        true
    }

    /// The link held by the previous process's switch, once.
    pub fn take_held_link(&self) -> Option<String> {
        let held = local_state::read(&self.app_data_dir).pending_handoff?;
        local_state::update(&self.app_data_dir, |state| state.pending_handoff = None);
        Some(held)
    }

    /// Makes the prepared profile the active one for the next process.
    pub async fn finish_switch(&self, id: &str) -> AppResult<()> {
        if self.switching.lock().expect("switch lock").as_deref() != Some(id) {
            return Err(AppError::ProfileSwitchRefused("switching"));
        }
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        if state.profiles.iter().all(|profile| profile.id != id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        state.active_id = Some(id.to_string());
        state.post_switch = true;
        self.save(&state)?;
        tracing::info!(from = %self.running.id, to = %id, "profile switch");
        Ok(())
    }

    /// Removes an inactive, non-default profile and everything it owns, right away.
    pub async fn delete(&self, pool: &SqlitePool, id: &str) -> AppResult<()> {
        let _edit = self.edits.lock().await;
        let mut state = self.load()?;
        if state.profiles.iter().all(|profile| profile.id != id) {
            return Err(AppError::ProfileNotFound(id.to_string()));
        }
        let switching_to = self.switching.lock().expect("switch lock").clone();
        if id == state.default_id()
            || id == self.running_id(&state)
            || id == state.active_id()
            || switching_to.as_deref() == Some(id)
        {
            return Err(AppError::ProfileInUse(id.to_string()));
        }
        let dir = self.profile_dir(id)?;
        state.profiles.retain(|profile| profile.id != id);
        self.save(&state)?;

        if let Err(error) = remove_dir_if_present(&dir) {
            tracing::warn!(profile = %id, %error, "could not remove a deleted profile's folder");
        }
        if let Err(error) = photos::remove(&self.app_data_dir, id) {
            tracing::warn!(profile = %id, %error, "could not remove a deleted profile's photo");
        }
        self.forget_keychain_item(id.to_string()).await;
        let owned = crate::profiles::collection_owners::prefix_of(id);
        if let Err(error) = crate::db::download_collections::delete_owned_by(pool, &owned).await {
            tracing::warn!(profile = %id, %error, "could not forget a deleted profile's download collections");
        }
        tracing::info!(profile = %id, "profile deleted");
        Ok(())
    }
}

/// A profile's folder. Only ids that pass the registry's check ever become a path.
pub fn profile_dir(app_data_dir: &Path, id: &str) -> AppResult<PathBuf> {
    if !registry::is_safe_id(id) {
        return Err(AppError::ProfileNotFound(id.to_string()));
    }
    Ok(app_data_dir.join("profiles").join(id))
}

fn find_mut<'a>(state: &'a mut RegistryState, id: &str) -> AppResult<&'a mut Profile> {
    state
        .profiles
        .iter_mut()
        .find(|profile| profile.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))
}

fn display_name(name: &str) -> String {
    if name.trim().is_empty() {
        "default".into()
    } else {
        name.trim().to_lowercase()
    }
}

fn valid_name(
    state: &RegistryState,
    editing: Option<&str>,
    name: &str,
    blank_ok: bool,
) -> AppResult<String> {
    let name = name.trim().to_string();
    if name.is_empty() && !blank_ok {
        return Err(AppError::ProfileName("blank"));
    }
    if name.encode_utf16().count() > registry::NAME_MAX_UNITS {
        return Err(AppError::ProfileName("tooLong"));
    }
    let wanted = display_name(&name);
    let taken = state
        .profiles
        .iter()
        .filter(|profile| Some(profile.id.as_str()) != editing)
        .any(|profile| display_name(&profile.name) == wanted);
    if taken {
        return Err(AppError::ProfileName("taken"));
    }
    Ok(name)
}

fn valid_color(color_key: &str) -> AppResult<String> {
    if color_key.is_empty() || registry::COLOR_KEYS.contains(&color_key) {
        Ok(color_key.to_string())
    } else {
        Err(AppError::Validation(format!(
            "unknown profile colour {color_key}"
        )))
    }
}

fn valid_new_avatar(avatar: ProfileAvatar) -> AppResult<ProfileAvatar> {
    match avatar.kind.as_str() {
        "initial" => Ok(ProfileAvatar {
            emoji: String::new(),
            photo_version: 0,
            ..avatar
        }),
        "emoji" if !avatar.emoji.is_empty() && avatar.emoji.chars().count() <= 16 => {
            Ok(ProfileAvatar {
                photo_version: 0,
                ..avatar
            })
        }
        "photo" => Ok(avatar),
        _ => Err(AppError::Validation("invalid profile avatar".into())),
    }
}

fn copied_keys(copy: &CopyParts) -> Vec<String> {
    let mut keys: Vec<String> = copy
        .settings
        .iter()
        .filter(|key| {
            !device_keys::is_device_key(key)
                && !key.starts_with("sync_")
                && !key.starts_with("sb_stats_")
                && !NEVER_COPIED_AS_SETTINGS.contains(&key.as_str())
                && !SUBSCRIPTION_KEYS.contains(&key.as_str())
                && !RECOMMENDATION_KEYS.contains(&key.as_str())
        })
        .cloned()
        .collect();
    if copy.subscriptions {
        keys.extend(SUBSCRIPTION_KEYS.iter().map(ToString::to_string));
    }
    if copy.recommendations {
        keys.extend(RECOMMENDATION_KEYS.iter().map(ToString::to_string));
    }
    keys
}

async fn fill_new_database(source: &SqlitePool, dir: &Path, copy: &CopyParts) -> AppResult<()> {
    let target = crate::db::initialize_database(dir.to_path_buf()).await?;
    let result = copy_settings(source, &target, &copied_keys(copy)).await;
    target.close().await;
    result
}

async fn copy_settings(source: &SqlitePool, target: &SqlitePool, keys: &[String]) -> AppResult<()> {
    let mut tx = target.begin().await?;
    for key in keys {
        let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(source)
            .await?;
        if let Some(value) = value {
            sqlx::query(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            )
            .bind(key)
            .bind(value)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

fn remove_dir_if_present(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

fn keychain_for(id: &str) -> ProfileScoped<Keychain> {
    let owner = ActiveProfile {
        id: id.to_string(),
        is_default: false,
        after_switch: false,
        default_name: String::new(),
    };
    ProfileScoped::new(Keychain, &owner)
}

fn forget_in_keychain(id: &str) -> bool {
    credentials::forget(&keychain_for(id)).is_ok()
}

/// Retries keychain deletes that failed earlier. Runs off the main thread at startup.
pub fn retry_keychain_deletes(app_data_dir: &Path) {
    let pending = local_state::read(app_data_dir).keychain_deletes;
    if pending.is_empty() {
        return;
    }
    let failed: Vec<String> = pending
        .into_iter()
        .filter(|id| !forget_in_keychain(id))
        .collect();
    local_state::update(app_data_dir, |state| state.keychain_deletes = failed);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("flow-profile-service-{}", registry::new_id()))
    }

    async fn setup() -> (PathBuf, ProfileService, SqlitePool) {
        let dir = temp_dir();
        let (running, _) = crate::profiles::load_for_process(&dir);
        let pool = crate::db::initialize_database(dir.clone()).await.unwrap();
        for (key, value) in [
            ("theme_id", "ocean"),
            ("autoplay_enabled", "false"),
            ("download_location", "/media"),
            ("subscriptions", "[1]"),
            ("subscription_groups", "[2]"),
            ("user_neuro_brain", "{brain}"),
            ("liked_items", "[likes]"),
            ("deep_flow_active", "true"),
        ] {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        let mut service = ProfileService::new(dir.clone(), running);
        service.forget_keychain_item = |_| true;
        (dir, service, pool)
    }

    fn request(name: &str, copy: CopyParts) -> NewProfile {
        NewProfile {
            name: name.into(),
            color_key: "teal".into(),
            avatar: ProfileAvatar::default(),
            copy,
        }
    }

    async fn keys_in(dir: &Path) -> Vec<String> {
        let pool = SqlitePool::connect(&format!(
            "sqlite://{}",
            dir.join("flow-desktop.sqlite").display()
        ))
        .await
        .unwrap();
        let mut keys: Vec<String> = sqlx::query_scalar("SELECT key FROM settings")
            .fetch_all(&pool)
            .await
            .unwrap();
        pool.close().await;
        keys.sort();
        keys
    }

    #[tokio::test]
    async fn each_copy_combination_copies_exactly_its_parts() {
        let (dir, service, pool) = setup().await;
        let settings = [
            "theme_id",
            "autoplay_enabled",
            "download_location",
            "deep_flow_active",
            "liked_items",
        ]
        .map(String::from)
        .to_vec();
        for (index, (with_settings, subscriptions, recommendations)) in [
            (false, false, false),
            (true, false, false),
            (false, true, false),
            (false, false, true),
            (true, true, true),
        ]
        .into_iter()
        .enumerate()
        {
            let copy = CopyParts {
                settings: if with_settings {
                    settings.clone()
                } else {
                    vec![]
                },
                subscriptions,
                recommendations,
            };
            let profile = service
                .create(&pool, request(&format!("P{index}"), copy))
                .await
                .unwrap();
            let mut expected: Vec<&str> = vec![];
            if with_settings {
                expected.extend(["autoplay_enabled", "theme_id"]);
            }
            if subscriptions {
                expected.extend(["subscription_groups", "subscriptions"]);
            }
            if recommendations {
                expected.push("user_neuro_brain");
            }
            expected.sort_unstable();
            assert_eq!(
                keys_in(&dir.join("profiles").join(&profile.id)).await,
                expected,
                "case {index}"
            );
            if index < 4 {
                service.delete(&pool, &profile.id).await.unwrap();
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_switch_is_refused_while_syncing_and_persists_the_target() {
        let (dir, service, pool) = setup().await;
        let study = service
            .create(&pool, request("Study", CopyParts::default()))
            .await
            .unwrap();
        let default_id = service.list().unwrap().default_id;
        assert!(matches!(
            service.prepare_switch(&default_id, false),
            Err(AppError::ProfileSwitchRefused("alreadyActive"))
        ));
        assert!(matches!(
            service.prepare_switch(&study.id, true),
            Err(AppError::ProfileSwitchRefused("syncRunning"))
        ));
        assert!(!service.is_switching());
        assert!(
            service.finish_switch(&study.id).await.is_err(),
            "nothing was prepared"
        );

        service.prepare_switch(&study.id, false).unwrap();
        assert!(matches!(
            service.prepare_switch(&study.id, false),
            Err(AppError::ProfileSwitchRefused("switching"))
        ));
        assert!(matches!(
            service.delete(&pool, &study.id).await,
            Err(AppError::ProfileInUse(_))
        ));
        service.finish_switch(&study.id).await.unwrap();
        let state = registry::load(&dir).unwrap();
        assert_eq!(state.active_id(), study.id);
        assert!(state.post_switch);
        assert_eq!(
            service.list().unwrap().active_id,
            default_id,
            "this process stays Default"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_link_is_held_only_during_a_switch_and_taken_once() {
        let (dir, service, pool) = setup().await;
        let study = service
            .create(&pool, request("Study", CopyParts::default()))
            .await
            .unwrap();
        assert!(!service.hold_link("flow://watch?v=a"));
        service.prepare_switch(&study.id, false).unwrap();
        assert!(service.hold_link("flow://watch?v=a"));
        assert!(service.hold_link("flow://watch?v=b"));
        assert_eq!(
            service.take_held_link().as_deref(),
            Some("flow://watch?v=b")
        );
        assert_eq!(service.take_held_link(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn the_limit_counts_default() {
        let (dir, service, pool) = setup().await;
        for index in 1..registry::MAX_PROFILES {
            service
                .create(&pool, request(&format!("P{index}"), CopyParts::default()))
                .await
                .unwrap();
        }
        let error = service
            .create(&pool, request("Six", CopyParts::default()))
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::ProfileLimit(5)));
        assert_eq!(service.list().unwrap().profiles.len(), 5);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn names_are_trimmed_unique_and_short() {
        let (dir, service, pool) = setup().await;
        let study = service
            .create(&pool, request("  Study ", CopyParts::default()))
            .await
            .unwrap();
        assert_eq!(study.name, "Study");
        for (name, reason) in [
            ("study", "taken"),
            ("Default", "taken"),
            ("  ", "blank"),
            (&"x".repeat(25), "tooLong"),
        ] {
            let error = service
                .create(&pool, request(name, CopyParts::default()))
                .await
                .unwrap_err();
            assert!(
                matches!(error, AppError::ProfileName(r) if r == reason),
                "{name}"
            );
        }
        let default_id = service.list().unwrap().default_id;
        assert_eq!(service.rename(&default_id, " ").await.unwrap().name, "");
        assert!(matches!(
            service.rename(&study.id, "").await.unwrap_err(),
            AppError::ProfileName("blank")
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn delete_removes_only_that_profile_and_never_default_or_the_running_one() {
        let (dir, service, pool) = setup().await;
        let a = service
            .create(&pool, request("A", CopyParts::default()))
            .await
            .unwrap();
        let b = service
            .create(&pool, request("B", CopyParts::default()))
            .await
            .unwrap();
        let view = service.list().unwrap();
        assert!(matches!(
            service.delete(&pool, &view.default_id).await.unwrap_err(),
            AppError::ProfileInUse(_)
        ));
        assert!(matches!(
            service.delete(&pool, &view.active_id).await.unwrap_err(),
            AppError::ProfileInUse(_)
        ));
        assert!(matches!(
            service.delete(&pool, "../x").await.unwrap_err(),
            AppError::ProfileNotFound(_)
        ));

        for owner in [&a.id, &b.id] {
            sqlx::query(
                "INSERT INTO download_collections (collection_id, kind, title, folder_path, total_count) VALUES (?, 'playlist', 't', '/f', 1)",
            )
            .bind(format!("{owner}:playlist-1"))
            .execute(&pool)
            .await
            .unwrap();
        }
        service.delete(&pool, &a.id).await.unwrap();
        let left: Vec<String> =
            sqlx::query_scalar("SELECT collection_id FROM download_collections")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(left, [format!("{}:playlist-1", b.id)]);
        assert!(!dir.join("profiles").join(&a.id).exists());
        assert!(
            dir.join("profiles")
                .join(&b.id)
                .join("flow-desktop.sqlite")
                .exists()
        );
        assert!(dir.join("flow-desktop.sqlite").exists());
        assert_eq!(service.list().unwrap().profiles.len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
