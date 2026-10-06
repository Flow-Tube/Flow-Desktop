//! Desktop settings ⇄ the canonical setting keys on the wire (`FLOW-SYNC/1` §6.4).
//!
//! Flow for Android only understands its own canonical names (`autoplay`, `return_youtube_dislikes`,
//! …) with typed values, so a shared setting is renamed and typed on the way out and mapped back
//! on the way in. Settings only the desktop has travel under a `desktop.` prefix, which Android
//! ignores and another desktop maps back. Older desktop builds sent raw desktop keys, which are
//! still accepted.
//!
//! `default_video_codec` is deliberately not synced: an AV1 or VP9 preference that suits one device
//! freezes video on a desktop or phone without that hardware decoder.

use serde_json::Value;

use crate::sync::canonical::{Hlc, SettingEntry};
use crate::sync::mapping::iso_to_ms;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Bool,
    Number,
    Text,
}

struct Shared {
    canonical: &'static str,
    desktop: &'static str,
    kind: Kind,
}

const fn shared(canonical: &'static str, desktop: &'static str, kind: Kind) -> Shared {
    Shared {
        canonical,
        desktop,
        kind,
    }
}

/// Settings both platforms have, mirroring Android's `SettingsMapper.WHITELIST`.
const SHARED: &[Shared] = &[
    shared("autoplay", "autoplay_enabled", Kind::Bool),
    shared("default_quality_wifi", "default_quality_wifi", Kind::Text),
    shared("playback_speed", "playback_speed", Kind::Number),
    shared("sponsorblock_enabled", "sponsorblock_enabled", Kind::Bool),
    shared(
        "sponsorblock_submit_enabled",
        "sb_submit_enabled",
        Kind::Bool,
    ),
    shared("dearrow_enabled", "dearrow_enabled", Kind::Bool),
    shared("dearrow_badge_enabled", "dearrow_badge_enabled", Kind::Bool),
    shared("subtitles_enabled", "subtitles_enabled", Kind::Bool),
    shared("trending_region", "trending_region", Kind::Text),
    shared("hide_watched_videos", "hide_watched_videos", Kind::Bool),
    shared("comments_enabled", "comments_enabled", Kind::Bool),
    shared("return_youtube_dislikes", "rytd_enabled", Kind::Bool),
    shared("video_loop", "video_loop_enabled", Kind::Bool),
    shared("skip_silence", "skip_silence_enabled", Kind::Bool),
    shared("stable_volume", "stable_volume_enabled", Kind::Bool),
    shared(
        "subscriptions_show_videos",
        "subscription_show_videos",
        Kind::Bool,
    ),
    shared(
        "subscriptions_show_shorts",
        "subscription_show_shorts",
        Kind::Bool,
    ),
    shared(
        "subscriptions_show_live",
        "subscription_show_live",
        Kind::Bool,
    ),
    shared("shorts_quality_wifi", "shorts_quality_wifi", Kind::Text),
    shared("music_audio_quality", "music_audio_quality", Kind::Text),
    shared(
        "preferred_audio_language",
        "preferred_audio_language",
        Kind::Text,
    ),
    shared(
        "preferred_subtitle_language",
        "preferred_subtitle_language",
        Kind::Text,
    ),
];

/// Player, content and extension preferences only the desktop has. Download paths, proxy
/// credentials, cache sizes, private ids and Deep Flow runtime state are deliberately absent.
const DESKTOP_ONLY: &[&str] = &[
    "allow_volume_boost",
    "remember_playback_speed",
    "custom_speeds_enabled",
    "custom_speed_presets",
    "long_press_playback_speed",
    "speed_slider_enabled",
    "double_tap_seek_seconds",
    "subtitle_font_size",
    "subtitle_bold",
    "mini_player_show_skip_controls",
    "mini_player_show_next_prev_controls",
    "show_fullscreen_title",
    "adaptive_player_size_enabled",
    "auto_pip_enabled",
    "manual_pip_button_enabled",
    "lyrics_provider_order",
    "lyrics_provider_enabled_states",
    "video_title_max_lines",
    "download_dialog_style",
    "home_feed_enabled",
    "show_app_logo_icon",
    "shorts_shelf_enabled",
    "home_shorts_shelf_enabled",
    "continue_watching_enabled",
    "show_related_videos",
    "disable_shorts_player",
    "shorts_navigation_enabled",
    "shorts_playback_mode",
    "shorts_auto_scroll_seconds",
    "music_navigation_enabled",
    "categories_nav_tab_enabled",
    "subscription_refresh_on_startup",
    "show_region_picker_in_explore",
    "deep_flow_expire_hours",
    "deep_flow_save_history",
    "sponsorblock_server",
    "sponsorblock_colors",
    "sponsorblock_categories",
];

const DESKTOP_PREFIX: &str = "desktop.";

/// Every desktop settings key that takes part in sync.
pub fn desktop_keys() -> impl Iterator<Item = &'static str> {
    SHARED
        .iter()
        .map(|s| s.desktop)
        .chain(DESKTOP_ONLY.iter().copied())
}

/// The wire entry for a stored desktop setting, stamped with the time the row last changed.
#[must_use]
pub fn local_entry(
    desktop_key: &str,
    stored: &str,
    updated_at: &str,
    device_id: &str,
) -> Option<SettingEntry> {
    let (key, value) = to_wire(desktop_key, stored)?;
    Some(SettingEntry {
        key,
        value,
        hlc: Hlc::new(iso_to_ms(updated_at), 0, device_id),
    })
}

/// The wire key and typed value for a stored desktop setting. `None` for a key that doesn't sync.
#[must_use]
pub fn to_wire(desktop_key: &str, stored: &str) -> Option<(String, Value)> {
    if let Some(s) = SHARED.iter().find(|s| s.desktop == desktop_key) {
        return Some((s.canonical.to_string(), typed(s.kind, stored)));
    }
    DESKTOP_ONLY.contains(&desktop_key).then(|| {
        (
            format!("{DESKTOP_PREFIX}{desktop_key}"),
            Value::String(stored.to_string()),
        )
    })
}

/// Normalize an incoming wire key to the form [`to_wire`] produces, accepting the raw desktop key
/// names older desktop builds sent. `None` for anything this desktop doesn't sync.
#[must_use]
pub fn normalize_wire_key(key: &str) -> Option<String> {
    if let Some(s) = SHARED
        .iter()
        .find(|s| s.canonical == key || s.desktop == key)
    {
        return Some(s.canonical.to_string());
    }
    let bare = key.strip_prefix(DESKTOP_PREFIX).unwrap_or(key);
    DESKTOP_ONLY
        .contains(&bare)
        .then(|| format!("{DESKTOP_PREFIX}{bare}"))
}

/// The desktop key and stored string for a normalized wire setting.
#[must_use]
pub fn from_wire(wire_key: &str, value: &Value) -> Option<(&'static str, String)> {
    let desktop = if let Some(s) = SHARED.iter().find(|s| s.canonical == wire_key) {
        s.desktop
    } else {
        let bare = wire_key.strip_prefix(DESKTOP_PREFIX)?;
        DESKTOP_ONLY.iter().copied().find(|k| *k == bare)?
    };
    let stored = match value {
        Value::String(s) => s.clone(),
        Value::Null => return None,
        other => other.to_string(),
    };
    Some((desktop, stored))
}

fn typed(kind: Kind, stored: &str) -> Value {
    match kind {
        Kind::Bool => match stored.trim() {
            "true" | "1" => Value::Bool(true),
            "false" | "0" => Value::Bool(false),
            _ => Value::String(stored.to_string()),
        },
        Kind::Number => stored
            .trim()
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map_or_else(|| Value::String(stored.to_string()), Value::Number),
        Kind::Text => Value::String(stored.to_string()),
    }
}
