//! Settings shared by every profile. They live in Default's `settings` table, and the settings
//! helpers route these keys there whichever profile is active. Rule (from Flow for Android): a
//! key with an Android twin takes the twin's scope; otherwise quality, network, storage,
//! downloads, language and region, input controls, updates and OS integrations are device-wide.

/// Device settings defined in `src/lib/settings/schema.ts` (`SETTING_SCOPES`); a test keeps the
/// two lists equal.
pub const SCHEMA_DEVICE_KEYS: [&str; 43] = [
    "allow_volume_boost",
    "player_volume",
    "player_muted",
    "long_press_playback_speed",
    "double_tap_seek_seconds",
    "show_region_picker_in_explore",
    "trending_region",
    "content_language",
    "default_quality_wifi",
    "default_video_codec",
    "shorts_quality_wifi",
    "music_audio_quality",
    "queue_swipe_left_action",
    "queue_swipe_right_action",
    "buffer_profile",
    "min_buffer_ms",
    "max_buffer_ms",
    "buffer_for_playback_ms",
    "buffer_for_playback_after_rebuffer_ms",
    "media_cache_size_mb",
    "remote_signature_fallback",
    "proxy_enabled",
    "proxy_type",
    "proxy_host",
    "proxy_port",
    "proxy_username",
    "proxy_password",
    "default_download_quality",
    "parallel_download_enabled",
    "download_threads",
    "download_location",
    "music_download_location",
    "download_poster_sidecar",
    "download_video_codec",
    "download_music_quality",
    "download_subtitle_language",
    "download_concurrency",
    "download_notifications",
    "download_lyrics_file",
    "auto_backup_frequency",
    "auto_backup_type",
    "discord_rpc_mode",
    "music_tray_enabled",
];

/// Device keys the frontend stores outside the schema.
pub const OTHER_DEVICE_KEYS: [&str; 4] = [
    "updater_preferences",
    "donation_first_launch_time",
    "donation_prompt_last_shown_time",
    "donation_prompt_disabled",
];

pub fn is_device_key(key: &str) -> bool {
    SCHEMA_DEVICE_KEYS.contains(&key) || OTHER_DEVICE_KEYS.contains(&key)
}
