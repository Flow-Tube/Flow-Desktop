import type { StringKey } from "../i18n/index";
import { IS_LINUX_RUNTIME } from "../platform";

export type SettingValueType = "boolean" | "number" | "string" | "json";
export type SettingArea =
  | "appearance"
  | "player"
  | "content"
  | "quality"
  | "network"
  | "downloads"
  | "data"
  | "extensions";
export type SettingReadiness = "wired" | "partial" | "persisted-only" | "deferred";
export type SettingVisibility = "visible" | "disabled-until-wired" | "internal";
export type SettingExportScope = "app-data" | "private" | "internal";

export interface SettingDefinition {
  key: string;
  area: SettingArea;
  type: SettingValueType;
  defaultValue: string;
  readiness: SettingReadiness;
  visibility: SettingVisibility;
  exportScope: SettingExportScope;
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
  noteKey?: StringKey;
}

export const SETTINGS = {
  THEME_ID: "theme_id",
  THEME_VARIANT: "theme_variant",
  EXPRESSIVE_SLIDERS_ENABLED: "expressive_sliders_enabled",
  CUSTOM_THEMES: "custom_themes",

  AUTOPLAY_ENABLED: "autoplay_enabled",
  VIDEO_LOOP_ENABLED: "video_loop_enabled",
  SKIP_SILENCE_ENABLED: "skip_silence_enabled",
  STABLE_VOLUME_ENABLED: "stable_volume_enabled",
  VIDEO_LOUDNESS_NORMALIZATION: "video_loudness_normalization",
  ALLOW_VOLUME_BOOST: "allow_volume_boost",
  PLAYER_VOLUME: "player_volume",
  PLAYER_MUTED: "player_muted",
  REMEMBER_PLAYBACK_SPEED: "remember_playback_speed",
  PLAYBACK_SPEED: "playback_speed",
  CUSTOM_SPEEDS_ENABLED: "custom_speeds_enabled",
  CUSTOM_SPEED_PRESETS: "custom_speed_presets",
  LONG_PRESS_PLAYBACK_SPEED: "long_press_playback_speed",
  SPEED_SLIDER_ENABLED: "speed_slider_enabled",
  DOUBLE_TAP_SEEK_SECONDS: "double_tap_seek_seconds",
  SUBTITLES_ENABLED: "subtitles_enabled",
  PREFERRED_SUBTITLE_LANGUAGE: "preferred_subtitle_language",
  SUBTITLE_FONT_SCALE: "subtitle_font_scale",
  SUBTITLE_BOLD: "subtitle_bold",
  MINI_PLAYER_SHOW_SKIP_CONTROLS: "mini_player_show_skip_controls",
  MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS: "mini_player_show_next_prev_controls",
  SHOW_FULLSCREEN_TITLE: "show_fullscreen_title",
  AMBIENT_MODE_ENABLED: "ambient_mode_enabled",
  ADAPTIVE_PLAYER_SIZE_ENABLED: "adaptive_player_size_enabled",
  AUTO_PIP_ENABLED: "auto_pip_enabled",
  MANUAL_PIP_BUTTON_ENABLED: "manual_pip_button_enabled",
  PIP_SEPARATE_WINDOW: "pip_separate_window",
  PIP_ALWAYS_ON_TOP: "pip_always_on_top",
  PIP_ON_MINIMIZE: "pip_on_minimize",
  MUSIC_PLAYER_BACKGROUND: "music_player_background",
  MUSIC_SIDE_PANE_VISIBLE: "music_side_pane_visible",
  MUSIC_ARTWORK_CONTROL_COLORS: "music_artwork_control_colors",
  MUSIC_PLAIN_CONTROL_COLORS: "music_plain_control_colors",
  MUSIC_PLAYER_FOLLOW_LIGHT_THEME: "music_player_follow_light_theme",
  MUSIC_RESTORE_QUEUE: "music_restore_queue",
  MUSIC_RESUME_LONG_TRACKS: "music_resume_long_tracks",
  MUSIC_SLEEP_TIMER_BUTTON: "music_sleep_timer_button",
  SLEEP_TIMER_CLOSE_APP_ON_EXPIRY: "sleep_timer_close_app_on_expiry",
  LYRICS_PROVIDER_ORDER: "lyrics_provider_order",
  LYRICS_PROVIDER_ENABLED_STATES: "lyrics_provider_enabled_states",
  LYRICS_TEXT_ALIGN: "lyrics_text_align",
  LYRICS_SHOW_TRANSLATION: "lyrics_show_translation",
  LYRICS_SHOW_ROMANIZATION: "lyrics_show_romanization",

  VIDEO_TITLE_MAX_LINES: "video_title_max_lines",
  GRID_COLUMNS: "grid_columns",
  HOME_FEED_ENABLED: "home_feed_enabled",
  SHOW_APP_LOGO_ICON: "show_app_logo_icon",
  SHORTS_SHELF_ENABLED: "shorts_shelf_enabled",
  HOME_SHORTS_SHELF_ENABLED: "home_shorts_shelf_enabled",
  CONTINUE_WATCHING_ENABLED: "continue_watching_enabled",
  COMMENTS_ENABLED: "comments_enabled",
  SHOW_RELATED_VIDEOS: "show_related_videos",
  LIVE_CHAT_ENABLED: "live_chat_enabled",
  BLOCKED_CONTENT_MODE: "blocked_content_mode",
  BLOCKED_REVEAL_PIN: "blocked_reveal_pin",
  HIDE_WATCHED_VIDEOS: "hide_watched_videos",
  DISABLE_SHORTS_PLAYER: "disable_shorts_player",
  SHORTS_NAVIGATION_ENABLED: "shorts_navigation_enabled",
  SHORTS_PLAYBACK_MODE: "shorts_playback_mode",
  SHORTS_AUTO_SCROLL_SECONDS: "shorts_auto_scroll_seconds",
  MUSIC_NAVIGATION_ENABLED: "music_navigation_enabled",
  CATEGORIES_NAV_TAB_ENABLED: "categories_nav_tab_enabled",
  SUBSCRIPTION_REFRESH_ON_STARTUP: "subscription_refresh_on_startup",
  SUBSCRIPTION_SHOW_VIDEOS: "subscription_show_videos",
  SUBSCRIPTION_SHOW_SHORTS: "subscription_show_shorts",
  SUBSCRIPTION_SHOW_LIVE: "subscription_show_live",
  NOTIFICATIONS_ENABLED: "notifications_enabled",
  NOTIFICATION_CHECK_INTERVAL: "notif_check_interval_minutes",
  SHOW_REGION_PICKER_IN_EXPLORE: "show_region_picker_in_explore",
  TRENDING_REGION: "trending_region",
  CONTENT_LANGUAGE: "content_language",
  DEEP_FLOW_ACTIVE: "deep_flow_active",
  DEEP_FLOW_ACTIVATED_AT: "deep_flow_activated_at",
  DEEP_FLOW_EXPIRE_HOURS: "deep_flow_expire_hours",
  DEEP_FLOW_SAVE_HISTORY: "deep_flow_save_history",

  DEFAULT_QUALITY_WIFI: "default_quality_wifi",
  DEFAULT_VIDEO_CODEC: "default_video_codec",
  SHORTS_QUALITY_WIFI: "shorts_quality_wifi",
  MUSIC_AUDIO_QUALITY: "music_audio_quality",
  MUSIC_QUEUE_SWIPE_LEFT: "queue_swipe_left_action",
  MUSIC_QUEUE_SWIPE_RIGHT: "queue_swipe_right_action",
  PREFERRED_AUDIO_LANGUAGE: "preferred_audio_language",

  MUSIC_LOUDNESS_NORMALIZATION: "music_loudness_normalization",
  EQ_STATE_JSON: "eq_state_json",
  MUSIC_PLAYBACK_SPEED: "music_playback_speed",
  MUSIC_CROSSFADE_ENABLED: "music_crossfade_enabled",
  MUSIC_CROSSFADE_SECONDS: "music_crossfade_seconds",

  BUFFER_PROFILE: "buffer_profile",
  MIN_BUFFER_MS: "min_buffer_ms",
  MAX_BUFFER_MS: "max_buffer_ms",
  BUFFER_FOR_PLAYBACK_MS: "buffer_for_playback_ms",
  BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS: "buffer_for_playback_after_rebuffer_ms",
  MEDIA_CACHE_SIZE_MB: "media_cache_size_mb",
  REMOTE_SIGNATURE_FALLBACK: "remote_signature_fallback",
  PROXY_ENABLED: "proxy_enabled",
  PROXY_TYPE: "proxy_type",
  PROXY_HOST: "proxy_host",
  PROXY_PORT: "proxy_port",
  PROXY_USERNAME: "proxy_username",
  PROXY_PASSWORD: "proxy_password",

  DEFAULT_DOWNLOAD_QUALITY: "default_download_quality",
  PARALLEL_DOWNLOAD_ENABLED: "parallel_download_enabled",
  DOWNLOAD_THREADS: "download_threads",
  DOWNLOAD_LOCATION: "download_location",
  MUSIC_DOWNLOAD_LOCATION: "music_download_location",
  DOWNLOAD_POSTER_SIDECAR: "download_poster_sidecar",
  DOWNLOAD_VIDEO_CODEC: "download_video_codec",
  DOWNLOAD_MUSIC_QUALITY: "download_music_quality",
  DOWNLOAD_SUBTITLE_LANGUAGE: "download_subtitle_language",
  DOWNLOAD_CONCURRENCY: "download_concurrency",
  DOWNLOAD_NOTIFICATIONS: "download_notifications",
  DOWNLOAD_LYRICS_FILE: "download_lyrics_file",

  AUTO_BACKUP_FREQUENCY: "auto_backup_frequency",
  AUTO_BACKUP_TYPE: "auto_backup_type",

  SPONSORBLOCK_ENABLED: "sponsorblock_enabled",
  DEARROW_ENABLED: "dearrow_enabled",
  DEARROW_BADGE_ENABLED: "dearrow_badge_enabled",
  RYTD_ENABLED: "rytd_enabled",
  DISCORD_RPC_MODE: "discord_rpc_mode",
  MUSIC_TRAY_ENABLED: "music_tray_enabled",
  SCROBBLE_NOW_PLAYING: "scrobble_now_playing",
  SCROBBLE_LOVE_LIKES: "scrobble_love_likes",
  DEEP_FLOW_SCROBBLE: "deep_flow_scrobble",
  SB_SUBMIT_ENABLED: "sb_submit_enabled",
  SPONSORBLOCK_USER_ID: "sponsorblock_user_id",
  SPONSORBLOCK_SERVER: "sponsorblock_server",
  SPONSORBLOCK_COLORS: "sponsorblock_colors",
  SPONSORBLOCK_CATEGORIES: "sponsorblock_categories",
  SPONSORBLOCK_SAVED_MINUTES: "sponsorblock_saved_minutes",
  SPONSORBLOCK_SAVED_SECONDS: "sponsorblock_saved_seconds",
  SPONSORBLOCK_SKIPPED_SEGMENTS: "sponsorblock_skipped_segments",
} as const;

export type SettingKey = (typeof SETTINGS)[keyof typeof SETTINGS];

const bool = (
  key: SettingKey,
  area: SettingArea,
  defaultValue: boolean,
  readiness: SettingReadiness,
  visibility: SettingVisibility = "visible",
  noteKey?: StringKey,
): SettingDefinition => ({
  key,
  area,
  type: "boolean",
  defaultValue: String(defaultValue),
  readiness,
  visibility,
  exportScope: visibility === "internal" ? "internal" : "app-data",
  noteKey,
});

const str = (
  key: SettingKey,
  area: SettingArea,
  defaultValue: string,
  readiness: SettingReadiness,
  allowedValues?: readonly string[],
  visibility: SettingVisibility = "visible",
  exportScope: SettingExportScope = "app-data",
  noteKey?: StringKey,
): SettingDefinition => ({
  key,
  area,
  type: "string",
  defaultValue,
  readiness,
  visibility,
  exportScope,
  allowedValues,
  noteKey,
});

const num = (
  key: SettingKey,
  area: SettingArea,
  defaultValue: number,
  readiness: SettingReadiness,
  min?: number,
  max?: number,
  visibility: SettingVisibility = "visible",
  noteKey?: StringKey,
): SettingDefinition => ({
  key,
  area,
  type: "number",
  defaultValue: String(defaultValue),
  readiness,
  visibility,
  exportScope: visibility === "internal" ? "internal" : "app-data",
  min,
  max,
  noteKey,
});

const json = (
  key: SettingKey,
  area: SettingArea,
  defaultValue: string,
  readiness: SettingReadiness,
  visibility: SettingVisibility = "visible",
  exportScope: SettingExportScope = "app-data",
  noteKey?: StringKey,
): SettingDefinition => ({
  key,
  area,
  type: "json",
  defaultValue,
  readiness,
  visibility,
  exportScope,
  noteKey,
});

const SPEED_VALUES = ["0.25", "0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0", "2.5", "3.0", "4.0"] as const;
const QUALITY_VALUES = ["Auto", "2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"] as const;

export const SETTING_DEFINITIONS = [
  str(SETTINGS.THEME_ID, "appearance", "default", "wired"),
  str(SETTINGS.THEME_VARIANT, "appearance", "dark", "wired", ["light", "dark", "amoled"]),
  bool(SETTINGS.EXPRESSIVE_SLIDERS_ENABLED, "appearance", true, "wired"),
  json(SETTINGS.CUSTOM_THEMES, "appearance", "[]", "wired"),

  bool(SETTINGS.AUTOPLAY_ENABLED, "player", true, "wired"),
  bool(SETTINGS.VIDEO_LOOP_ENABLED, "player", false, "wired"),
  bool(SETTINGS.SKIP_SILENCE_ENABLED, "player", false, "deferred", "disabled-until-wired", "settings_note_skip_silence_requires_audio_analysis"),
  bool(SETTINGS.STABLE_VOLUME_ENABLED, "player", false, "wired"),
  bool(SETTINGS.VIDEO_LOUDNESS_NORMALIZATION, "player", false, "wired"),
  bool(SETTINGS.ALLOW_VOLUME_BOOST, "player", false, "deferred", "disabled-until-wired", "settings_note_volume_boost_requires_audio_gain"),
  num(SETTINGS.PLAYER_VOLUME, "player", 1, "wired", 0, 1, "internal"),
  bool(SETTINGS.PLAYER_MUTED, "player", false, "wired", "internal"),
  bool(SETTINGS.MUSIC_SIDE_PANE_VISIBLE, "player", true, "wired", "internal"),
  bool(SETTINGS.REMEMBER_PLAYBACK_SPEED, "player", false, "wired"),
  str(SETTINGS.PLAYBACK_SPEED, "player", "1.0", "wired", SPEED_VALUES),
  bool(SETTINGS.CUSTOM_SPEEDS_ENABLED, "player", false, "wired"),
  str(SETTINGS.CUSTOM_SPEED_PRESETS, "player", "", "wired"),
  str(SETTINGS.LONG_PRESS_PLAYBACK_SPEED, "player", "2.0", "wired", ["1.5", "2.0", "2.5", "3.0", "4.0", "off"]),
  bool(SETTINGS.SPEED_SLIDER_ENABLED, "player", false, "wired"),
  num(SETTINGS.DOUBLE_TAP_SEEK_SECONDS, "player", 10, "wired", 5, 30),
  bool(SETTINGS.SUBTITLES_ENABLED, "player", false, "wired"),
  str(SETTINGS.PREFERRED_SUBTITLE_LANGUAGE, "player", "en", "wired"),
  str(SETTINGS.SUBTITLE_FONT_SCALE, "player", "100", "wired", ["50", "75", "100", "150", "200", "300", "400"]),
  bool(SETTINGS.SUBTITLE_BOLD, "player", true, "wired"),
  bool(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS, "player", true, "wired"),
  bool(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS, "player", true, "wired"),
  bool(SETTINGS.SHOW_FULLSCREEN_TITLE, "player", false, "wired"),
  bool(SETTINGS.AMBIENT_MODE_ENABLED, "player", true, "wired"),
  bool(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED, "player", true, "persisted-only"),
  bool(SETTINGS.AUTO_PIP_ENABLED, "player", true, "wired"),
  bool(SETTINGS.MANUAL_PIP_BUTTON_ENABLED, "player", true, "wired"),
  bool(SETTINGS.PIP_SEPARATE_WINDOW, "player", true, "wired"),
  bool(SETTINGS.PIP_ALWAYS_ON_TOP, "player", true, "wired"),
  bool(SETTINGS.PIP_ON_MINIMIZE, "player", true, "wired"),
  str(SETTINGS.MUSIC_PLAYER_BACKGROUND, "player", "blur_gradient", "wired",
    ["blur_gradient", "blur", "gradient", "immersive", "default"]),
  bool(SETTINGS.MUSIC_ARTWORK_CONTROL_COLORS, "player", true, "wired"),
  str(SETTINGS.MUSIC_PLAIN_CONTROL_COLORS, "player", "monochrome", "wired", ["monochrome", "app_theme"]),
  bool(SETTINGS.MUSIC_PLAYER_FOLLOW_LIGHT_THEME, "player", false, "wired"),
  bool(SETTINGS.MUSIC_RESTORE_QUEUE, "player", true, "wired"),
  bool(SETTINGS.MUSIC_RESUME_LONG_TRACKS, "player", false, "wired"),
  bool(SETTINGS.MUSIC_SLEEP_TIMER_BUTTON, "player", false, "wired"),
  bool(SETTINGS.SLEEP_TIMER_CLOSE_APP_ON_EXPIRY, "player", false, "wired"),
  str(SETTINGS.LYRICS_PROVIDER_ORDER, "player", "", "wired"),
  json(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES, "player", "{}", "wired"),
  str(SETTINGS.LYRICS_TEXT_ALIGN, "player", "center", "wired", ["left", "center", "right"]),
  bool(SETTINGS.LYRICS_SHOW_TRANSLATION, "player", true, "wired"),
  bool(SETTINGS.LYRICS_SHOW_ROMANIZATION, "player", true, "wired"),

  num(SETTINGS.VIDEO_TITLE_MAX_LINES, "content", 1, "wired", 0, 3),
  num(SETTINGS.GRID_COLUMNS, "content", 4, "wired", 2, 8),
  bool(SETTINGS.HOME_FEED_ENABLED, "content", true, "wired"),
  bool(SETTINGS.SHOW_APP_LOGO_ICON, "content", true, "wired"),
  bool(SETTINGS.SHORTS_SHELF_ENABLED, "content", true, "wired"),
  bool(SETTINGS.HOME_SHORTS_SHELF_ENABLED, "content", true, "persisted-only"),
  bool(SETTINGS.CONTINUE_WATCHING_ENABLED, "content", true, "wired"),
  bool(SETTINGS.COMMENTS_ENABLED, "content", true, "wired"),
  bool(SETTINGS.SHOW_RELATED_VIDEOS, "content", true, "wired"),
  bool(SETTINGS.LIVE_CHAT_ENABLED, "content", true, "wired"),
  str(SETTINGS.BLOCKED_CONTENT_MODE, "content", "blur", "wired", ["blur", "hide"]),
  str(SETTINGS.BLOCKED_REVEAL_PIN, "content", "", "wired", undefined, "internal", "private"),
  bool(SETTINGS.HIDE_WATCHED_VIDEOS, "content", false, "wired"),
  bool(SETTINGS.DISABLE_SHORTS_PLAYER, "content", false, "wired"),
  bool(SETTINGS.SHORTS_NAVIGATION_ENABLED, "content", true, "wired"),
  str(SETTINGS.SHORTS_PLAYBACK_MODE, "content", "loop", "wired", ["loop", "auto_next", "auto_interval"]),
  num(SETTINGS.SHORTS_AUTO_SCROLL_SECONDS, "content", 10, "wired", 5, 20),
  bool(SETTINGS.MUSIC_NAVIGATION_ENABLED, "content", true, "wired"),
  bool(SETTINGS.CATEGORIES_NAV_TAB_ENABLED, "content", true, "wired"),
  bool(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP, "content", false, "persisted-only"),
  bool(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS, "content", true, "wired"),
  bool(SETTINGS.SUBSCRIPTION_SHOW_SHORTS, "content", true, "wired"),
  bool(SETTINGS.SUBSCRIPTION_SHOW_LIVE, "content", true, "wired"),
  bool(SETTINGS.NOTIFICATIONS_ENABLED, "content", true, "wired"),
  str(SETTINGS.NOTIFICATION_CHECK_INTERVAL, "content", "360", "wired", ["15", "30", "60", "180", "360", "720", "1440"]),
  bool(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE, "content", true, "wired"),
  str(SETTINGS.TRENDING_REGION, "content", "US", "wired"),
  str(SETTINGS.CONTENT_LANGUAGE, "content", "", "wired"),
  // Session state, not a preference: exporting it can permanently mute history recording
  // on the restoring device (its paired activated_at timestamp is internal too).
  bool(SETTINGS.DEEP_FLOW_ACTIVE, "content", false, "wired", "internal"),
  num(SETTINGS.DEEP_FLOW_ACTIVATED_AT, "content", 0, "wired", 0, undefined, "internal"),
  str(SETTINGS.DEEP_FLOW_EXPIRE_HOURS, "content", "4", "wired", ["0", "1", "2", "4", "6", "8", "12", "24"]),
  bool(SETTINGS.DEEP_FLOW_SAVE_HISTORY, "content", false, "wired"),

  str(SETTINGS.DEFAULT_QUALITY_WIFI, "quality", "1080p", "wired", QUALITY_VALUES),
  str(SETTINGS.DEFAULT_VIDEO_CODEC, "quality", "H.264", "wired", ["Auto", "H.264", "VP9", "AV1"]),
  str(SETTINGS.SHORTS_QUALITY_WIFI, "quality", "720p", "wired", QUALITY_VALUES),
  str(SETTINGS.MUSIC_AUDIO_QUALITY, "quality", "Auto", "wired", ["Auto", "High", "Medium", "Low"]),
  str(SETTINGS.MUSIC_QUEUE_SWIPE_LEFT, "player", "PLAY_NEXT", "wired", ["PLAY_NEXT", "MOVE_TO_END", "REMOVE"]),
  str(SETTINGS.MUSIC_QUEUE_SWIPE_RIGHT, "player", "REMOVE", "wired", ["PLAY_NEXT", "MOVE_TO_END", "REMOVE"]),
  str(SETTINGS.PREFERRED_AUDIO_LANGUAGE, "quality", "original", "persisted-only"),

  bool(SETTINGS.MUSIC_LOUDNESS_NORMALIZATION, "player", true, "wired"),
  // Flow for Android's equalizer JSON, shared by music and video and synced as `equalizer`.
  json(SETTINGS.EQ_STATE_JSON, "player", "{}", "wired"),
  num(SETTINGS.MUSIC_PLAYBACK_SPEED, "player", 1, "wired", 0.5, 2),
  bool(SETTINGS.MUSIC_CROSSFADE_ENABLED, "player", false, "wired"),
  num(SETTINGS.MUSIC_CROSSFADE_SECONDS, "player", 5, "wired", 1, 12),

  str(SETTINGS.BUFFER_PROFILE, "network", "STABLE", "wired", ["AGGRESSIVE", "STABLE", "DATASAVER", "CUSTOM"]),
  num(SETTINGS.MIN_BUFFER_MS, "network", 30000, "wired", 5000, 120000),
  num(SETTINGS.MAX_BUFFER_MS, "network", 50000, "wired", 25000, 120000),
  num(SETTINGS.BUFFER_FOR_PLAYBACK_MS, "network", 2500, "partial", 500, 5000),
  num(SETTINGS.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS, "network", 5000, "partial", 2500, 10000),
  num(SETTINGS.MEDIA_CACHE_SIZE_MB, "network", 500, "deferred", 0, 2000, "disabled-until-wired", "settings_note_media_cache_accounting_missing"),
  bool(SETTINGS.REMOTE_SIGNATURE_FALLBACK, "network", false, "wired"),
  bool(SETTINGS.PROXY_ENABLED, "network", false, "persisted-only"),
  str(SETTINGS.PROXY_TYPE, "network", "http", "persisted-only", ["http", "socks5", "socks4"]),
  str(SETTINGS.PROXY_HOST, "network", "", "persisted-only"),
  str(SETTINGS.PROXY_PORT, "network", "8080", "persisted-only"),
  str(SETTINGS.PROXY_USERNAME, "network", "", "persisted-only", undefined, "visible", "private"),
  str(SETTINGS.PROXY_PASSWORD, "network", "", "persisted-only", undefined, "visible", "private"),

  str(SETTINGS.DEFAULT_DOWNLOAD_QUALITY, "downloads", "1080p", "wired", QUALITY_VALUES),
  str(SETTINGS.DOWNLOAD_VIDEO_CODEC, "downloads", "Auto", "wired", ["Auto", "H.264", "VP9", "AV1"]),
  str(SETTINGS.DOWNLOAD_MUSIC_QUALITY, "downloads", "High", "wired", ["High", "Low"]),
  str(SETTINGS.DOWNLOAD_SUBTITLE_LANGUAGE, "downloads", "", "wired"),
  num(SETTINGS.DOWNLOAD_CONCURRENCY, "downloads", 3, "wired", 1, 5),
  bool(SETTINGS.DOWNLOAD_NOTIFICATIONS, "downloads", true, "wired"),
  bool(SETTINGS.PARALLEL_DOWNLOAD_ENABLED, "downloads", true, "wired"),
  num(SETTINGS.DOWNLOAD_THREADS, "downloads", 3, "wired", 1, 8),
  str(SETTINGS.DOWNLOAD_LOCATION, "downloads", "", "wired"),
  str(SETTINGS.MUSIC_DOWNLOAD_LOCATION, "downloads", "", "wired"),
  bool(SETTINGS.DOWNLOAD_POSTER_SIDECAR, "downloads", false, "wired"),
  bool(SETTINGS.DOWNLOAD_LYRICS_FILE, "downloads", true, "wired"),

  str(SETTINGS.AUTO_BACKUP_FREQUENCY, "data", "NONE", "persisted-only", ["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
  str(SETTINGS.AUTO_BACKUP_TYPE, "data", "APP_DATA", "wired", ["APP_DATA", "BRAIN", "MASTER"]),

  bool(SETTINGS.SPONSORBLOCK_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.DEARROW_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.DEARROW_BADGE_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.RYTD_ENABLED, "extensions", true, "wired"),
  str(SETTINGS.DISCORD_RPC_MODE, "extensions", "off", "wired", ["off", "music", "videos", "musicAndVideos"]),
  // Linux trays need an AppIndicator library and a desktop that shows them, so it is opt-in there.
  bool(SETTINGS.MUSIC_TRAY_ENABLED, "extensions", !IS_LINUX_RUNTIME, "wired"),
  bool(SETTINGS.SCROBBLE_NOW_PLAYING, "extensions", true, "wired"),
  bool(SETTINGS.SCROBBLE_LOVE_LIKES, "extensions", false, "wired"),
  bool(SETTINGS.DEEP_FLOW_SCROBBLE, "extensions", false, "wired"),
  bool(SETTINGS.SB_SUBMIT_ENABLED, "extensions", false, "wired"),
  str(SETTINGS.SPONSORBLOCK_USER_ID, "extensions", "", "persisted-only", undefined, "visible", "private"),
  str(SETTINGS.SPONSORBLOCK_SERVER, "extensions", "https://sponsor.ajay.app", "wired"),
  json(SETTINGS.SPONSORBLOCK_COLORS, "extensions", "{}", "wired"),
  json(SETTINGS.SPONSORBLOCK_CATEGORIES, "extensions", "{}", "wired"),
  num(SETTINGS.SPONSORBLOCK_SAVED_MINUTES, "extensions", 0, "wired", 0, undefined, "internal"),
  num(SETTINGS.SPONSORBLOCK_SAVED_SECONDS, "extensions", 0, "wired", 0, undefined, "internal"),
  num(SETTINGS.SPONSORBLOCK_SKIPPED_SEGMENTS, "extensions", 0, "wired", 0, undefined, "internal"),
] as const satisfies readonly SettingDefinition[];

export const SETTING_DEFINITIONS_BY_KEY: ReadonlyMap<SettingKey, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.key as SettingKey, definition]),
);

export const SETTING_EXPORT_KEYS = SETTING_DEFINITIONS
  .filter((definition) => definition.exportScope === "app-data")
  .map((definition) => definition.key);
