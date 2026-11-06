//! Settings shared by every profile. They live in Default's `settings` table, and the settings
//! helpers route these keys there whichever profile is active. Rule (from Flow for Android): a
//! key with an Android twin takes the twin's scope; otherwise quality, network, storage,
//! downloads, language and region, input controls, updates and OS integrations are device-wide.

/// Device settings defined in `src/lib/settings/schema.ts` (`SETTING_SCOPES`); a test keeps the
/// two lists equal.
pub const SCHEMA_DEVICE_KEYS: [&str; 58] = [
    "allow_volume_boost",
    "player_volume",
    "player_volume_boost",
    "player_muted",
    "long_press_playback_speed",
    "double_tap_seek_seconds",
    "idle_progress_strip_enabled",
    "frame_step_buttons_enabled",
    "show_region_picker_in_explore",
    "trending_region",
    "app_language",
    "content_language",
    "default_quality_wifi",
    "default_video_codec",
    "fast_quality_switch_enabled",
    "shorts_quality_wifi",
    "music_audio_quality",
    "queue_swipe_left_action",
    "queue_swipe_right_action",
    "buffer_profile",
    "min_buffer_ms",
    "max_buffer_ms",
    "buffer_for_playback_ms",
    "buffer_for_playback_after_rebuffer_ms",
    "remote_signature_fallback",
    "highlight_new_settings",
    "highlight_new_settings_days",
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
    "auto_download_opened_videos",
    "auto_download_liked_music",
    "local_media_hide_recordings",
    "local_media_min_audio_seconds",
    "auto_backup_frequency",
    "auto_backup_type",
    "auto_backup_folder",
    "auto_backup_last_run",
    "auto_backup_last_error",
    "discord_rpc_mode",
    "music_tray_enabled",
    "pause_music_when_muted",
    "global_media_keys_enabled",
];

/// Device keys kept outside the schema.
pub const OTHER_DEVICE_KEYS: [&str; 5] = [
    "updater_preferences",
    "donation_first_launch_time",
    "donation_prompt_last_shown_time",
    "donation_prompt_disabled",
    "local_media_reading",
];

pub fn is_device_key(key: &str) -> bool {
    SCHEMA_DEVICE_KEYS.contains(&key) || OTHER_DEVICE_KEYS.contains(&key)
}
