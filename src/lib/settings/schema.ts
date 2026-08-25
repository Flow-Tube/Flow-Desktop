import type { StringKey } from "../i18n/index";

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
  ALLOW_VOLUME_BOOST: "allow_volume_boost",
  REMEMBER_PLAYBACK_SPEED: "remember_playback_speed",
  PLAYBACK_SPEED: "playback_speed",
  CUSTOM_SPEEDS_ENABLED: "custom_speeds_enabled",
  CUSTOM_SPEED_PRESETS: "custom_speed_presets",
  LONG_PRESS_PLAYBACK_SPEED: "long_press_playback_speed",
  SPEED_SLIDER_ENABLED: "speed_slider_enabled",
  DOUBLE_TAP_SEEK_SECONDS: "double_tap_seek_seconds",
  SUBTITLES_ENABLED: "subtitles_enabled",
  PREFERRED_SUBTITLE_LANGUAGE: "preferred_subtitle_language",
  SUBTITLE_FONT_SIZE: "subtitle_font_size",
  SUBTITLE_BOLD: "subtitle_bold",
  MINI_PLAYER_SHOW_SKIP_CONTROLS: "mini_player_show_skip_controls",
  MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS: "mini_player_show_next_prev_controls",
  SHOW_FULLSCREEN_TITLE: "show_fullscreen_title",
  ADAPTIVE_PLAYER_SIZE_ENABLED: "adaptive_player_size_enabled",
  AUTO_PIP_ENABLED: "auto_pip_enabled",
  MANUAL_PIP_BUTTON_ENABLED: "manual_pip_button_enabled",
  MUSIC_PLAYER_BACKGROUND: "music_player_background",
  LYRICS_PROVIDER_ORDER: "lyrics_provider_order",
  LYRICS_PROVIDER_ENABLED_STATES: "lyrics_provider_enabled_states",

  VIDEO_TITLE_MAX_LINES: "video_title_max_lines",
  GRID_COLUMNS: "grid_columns",
  DOWNLOAD_DIALOG_STYLE: "download_dialog_style",
  HOME_FEED_ENABLED: "home_feed_enabled",
  SHOW_APP_LOGO_ICON: "show_app_logo_icon",
  SHORTS_SHELF_ENABLED: "shorts_shelf_enabled",
  HOME_SHORTS_SHELF_ENABLED: "home_shorts_shelf_enabled",
  CONTINUE_WATCHING_ENABLED: "continue_watching_enabled",
  COMMENTS_ENABLED: "comments_enabled",
  SHOW_RELATED_VIDEOS: "show_related_videos",
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
  DEEP_FLOW_ACTIVE: "deep_flow_active",
  DEEP_FLOW_ACTIVATED_AT: "deep_flow_activated_at",
  DEEP_FLOW_EXPIRE_HOURS: "deep_flow_expire_hours",
  DEEP_FLOW_SAVE_HISTORY: "deep_flow_save_history",

  DEFAULT_QUALITY_WIFI: "default_quality_wifi",
  DEFAULT_VIDEO_CODEC: "default_video_codec",
  SHORTS_QUALITY_WIFI: "shorts_quality_wifi",
  MUSIC_AUDIO_QUALITY: "music_audio_quality",
  PREFERRED_AUDIO_LANGUAGE: "preferred_audio_language",

  BUFFER_PROFILE: "buffer_profile",
  MIN_BUFFER_MS: "min_buffer_ms",
  MAX_BUFFER_MS: "max_buffer_ms",
  BUFFER_FOR_PLAYBACK_MS: "buffer_for_playback_ms",
  BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS: "buffer_for_playback_after_rebuffer_ms",
  MEDIA_CACHE_SIZE_MB: "media_cache_size_mb",
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
  DOWNLOAD_THUMBNAILS_ENABLED: "download_thumbnails_enabled",
  DOWNLOAD_THUMBNAIL_MODE: "download_thumbnail_mode",

  AUTO_BACKUP_FREQUENCY: "auto_backup_frequency",
  AUTO_BACKUP_TYPE: "auto_backup_type",

  SPONSORBLOCK_ENABLED: "sponsorblock_enabled",
  DEARROW_ENABLED: "dearrow_enabled",
  DEARROW_BADGE_ENABLED: "dearrow_badge_enabled",
  RYTD_ENABLED: "rytd_enabled",
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
  bool(SETTINGS.STABLE_VOLUME_ENABLED, "player", false, "deferred", "disabled-until-wired", "settings_note_stable_volume_requires_audio_pipeline"),
  bool(SETTINGS.ALLOW_VOLUME_BOOST, "player", false, "deferred", "disabled-until-wired", "settings_note_volume_boost_requires_audio_gain"),
  bool(SETTINGS.REMEMBER_PLAYBACK_SPEED, "player", false, "wired"),
  str(SETTINGS.PLAYBACK_SPEED, "player", "1.0", "wired", SPEED_VALUES),
  bool(SETTINGS.CUSTOM_SPEEDS_ENABLED, "player", false, "wired"),
  str(SETTINGS.CUSTOM_SPEED_PRESETS, "player", "", "wired"),
  str(SETTINGS.LONG_PRESS_PLAYBACK_SPEED, "player", "2.0", "wired", ["1.5", "2.0", "2.5", "3.0", "4.0"]),
  bool(SETTINGS.SPEED_SLIDER_ENABLED, "player", false, "wired"),
  num(SETTINGS.DOUBLE_TAP_SEEK_SECONDS, "player", 10, "wired", 5, 30),
  bool(SETTINGS.SUBTITLES_ENABLED, "player", false, "wired"),
  str(SETTINGS.PREFERRED_SUBTITLE_LANGUAGE, "player", "en", "wired"),
  str(SETTINGS.SUBTITLE_FONT_SIZE, "player", "14", "wired", ["10", "12", "14", "16", "18", "20", "24"]),
  bool(SETTINGS.SUBTITLE_BOLD, "player", true, "wired"),
  bool(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS, "player", true, "wired"),
  bool(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS, "player", true, "wired"),
  bool(SETTINGS.SHOW_FULLSCREEN_TITLE, "player", false, "wired"),
  bool(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED, "player", true, "persisted-only"),
  bool(SETTINGS.AUTO_PIP_ENABLED, "player", true, "wired"),
  bool(SETTINGS.MANUAL_PIP_BUTTON_ENABLED, "player", true, "wired"),
  str(SETTINGS.MUSIC_PLAYER_BACKGROUND, "player", "blur_gradient", "wired",
    ["blur_gradient", "blur", "gradient", "default"]),
  str(SETTINGS.LYRICS_PROVIDER_ORDER, "player", "", "wired"),
  json(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES, "player", "{}", "wired"),

  num(SETTINGS.VIDEO_TITLE_MAX_LINES, "content", 1, "wired", 0, 3),
  num(SETTINGS.GRID_COLUMNS, "content", 4, "wired", 2, 8),
  str(SETTINGS.DOWNLOAD_DIALOG_STYLE, "content", "FULL", "wired", ["FULL", "COMPACT"]),
  bool(SETTINGS.HOME_FEED_ENABLED, "content", true, "wired"),
  bool(SETTINGS.SHOW_APP_LOGO_ICON, "content", true, "wired"),
  bool(SETTINGS.SHORTS_SHELF_ENABLED, "content", true, "wired"),
  bool(SETTINGS.HOME_SHORTS_SHELF_ENABLED, "content", true, "persisted-only"),
  bool(SETTINGS.CONTINUE_WATCHING_ENABLED, "content", true, "wired"),
  bool(SETTINGS.COMMENTS_ENABLED, "content", true, "wired"),
  bool(SETTINGS.SHOW_RELATED_VIDEOS, "content", true, "wired"),
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
  str(SETTINGS.TRENDING_REGION, "content", "US", "persisted-only"),
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
  str(SETTINGS.PREFERRED_AUDIO_LANGUAGE, "quality", "original", "persisted-only"),

  str(SETTINGS.BUFFER_PROFILE, "network", "STABLE", "wired", ["AGGRESSIVE", "STABLE", "DATASAVER", "CUSTOM"]),
  num(SETTINGS.MIN_BUFFER_MS, "network", 30000, "wired", 5000, 120000),
  num(SETTINGS.MAX_BUFFER_MS, "network", 50000, "wired", 25000, 120000),
  num(SETTINGS.BUFFER_FOR_PLAYBACK_MS, "network", 2500, "partial", 500, 5000),
  num(SETTINGS.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS, "network", 5000, "partial", 2500, 10000),
  num(SETTINGS.MEDIA_CACHE_SIZE_MB, "network", 500, "deferred", 0, 2000, "disabled-until-wired", "settings_note_media_cache_accounting_missing"),
  bool(SETTINGS.PROXY_ENABLED, "network", false, "persisted-only"),
  str(SETTINGS.PROXY_TYPE, "network", "http", "persisted-only", ["http", "socks5", "socks4"]),
  str(SETTINGS.PROXY_HOST, "network", "", "persisted-only"),
  str(SETTINGS.PROXY_PORT, "network", "8080", "persisted-only"),
  str(SETTINGS.PROXY_USERNAME, "network", "", "persisted-only", undefined, "visible", "private"),
  str(SETTINGS.PROXY_PASSWORD, "network", "", "persisted-only", undefined, "visible", "private"),

  str(SETTINGS.DEFAULT_DOWNLOAD_QUALITY, "downloads", "720p", "wired", QUALITY_VALUES),
  bool(SETTINGS.PARALLEL_DOWNLOAD_ENABLED, "downloads", true, "wired"),
  num(SETTINGS.DOWNLOAD_THREADS, "downloads", 3, "wired", 1, 8),
  str(SETTINGS.DOWNLOAD_LOCATION, "downloads", "", "wired"),
  str(SETTINGS.MUSIC_DOWNLOAD_LOCATION, "downloads", "", "wired"),
  bool(SETTINGS.DOWNLOAD_THUMBNAILS_ENABLED, "downloads", true, "wired"),
  str(SETTINGS.DOWNLOAD_THUMBNAIL_MODE, "downloads", "SIDECAR", "wired", ["SIDECAR", "EMBED", "BOTH"]),

  str(SETTINGS.AUTO_BACKUP_FREQUENCY, "data", "NONE", "persisted-only", ["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
  str(SETTINGS.AUTO_BACKUP_TYPE, "data", "APP_DATA", "wired", ["APP_DATA", "BRAIN", "MASTER"]),

  bool(SETTINGS.SPONSORBLOCK_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.DEARROW_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.DEARROW_BADGE_ENABLED, "extensions", true, "wired"),
  bool(SETTINGS.RYTD_ENABLED, "extensions", true, "wired"),
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
