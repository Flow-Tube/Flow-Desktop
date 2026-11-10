import type { StringKey } from "./i18n/index";
import { SETTINGS, type SettingKey } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

export interface PlayerButtonRow {
  id: PlayerButtonId;
  setting: SettingKey;
  title: StringKey;
  summary: StringKey;
}

export type PlayerButtonId =
  | "nextPrevious"
  | "volume"
  | "chapters"
  | "queue"
  | "liveChat"
  | "comments"
  | "sponsorBlock"
  | "autoplay"
  | "quality"
  | "captions"
  | "playOn"
  | "theater"
  | "fullscreen";

/** Every control on the player bar someone can do without. Play and Settings always stay. */
export const PLAYER_BUTTON_ROWS: readonly PlayerButtonRow[] = [
  { id: "nextPrevious", setting: SETTINGS.PLAYER_BUTTON_NEXT_PREVIOUS, title: "settings_button_next_previous", summary: "settings_button_next_previous_desc" },
  { id: "volume", setting: SETTINGS.PLAYER_BUTTON_VOLUME, title: "settings_button_volume", summary: "settings_button_volume_desc" },
  { id: "chapters", setting: SETTINGS.PLAYER_BUTTON_CHAPTERS, title: "settings_button_chapters", summary: "settings_button_chapters_desc" },
  { id: "queue", setting: SETTINGS.PLAYER_BUTTON_QUEUE, title: "settings_button_queue", summary: "settings_button_queue_desc" },
  { id: "liveChat", setting: SETTINGS.PLAYER_BUTTON_LIVE_CHAT, title: "settings_button_live_chat", summary: "settings_button_live_chat_desc" },
  { id: "comments", setting: SETTINGS.PLAYER_BUTTON_COMMENTS, title: "settings_button_comments", summary: "settings_button_comments_desc" },
  { id: "sponsorBlock", setting: SETTINGS.PLAYER_BUTTON_SPONSORBLOCK, title: "settings_button_sponsorblock", summary: "settings_button_sponsorblock_desc" },
  { id: "autoplay", setting: SETTINGS.PLAYER_BUTTON_AUTOPLAY, title: "settings_button_autoplay", summary: "settings_button_autoplay_desc" },
  { id: "quality", setting: SETTINGS.PLAYER_BUTTON_QUALITY, title: "settings_button_quality", summary: "settings_button_quality_desc" },
  { id: "captions", setting: SETTINGS.PLAYER_BUTTON_CAPTIONS, title: "settings_button_captions", summary: "settings_button_captions_desc" },
  { id: "playOn", setting: SETTINGS.PLAYER_BUTTON_PLAY_ON, title: "settings_button_play_on", summary: "settings_button_play_on_desc" },
  { id: "theater", setting: SETTINGS.PLAYER_BUTTON_THEATER, title: "settings_button_theater", summary: "settings_button_theater_desc" },
  { id: "fullscreen", setting: SETTINGS.PLAYER_BUTTON_FULLSCREEN, title: "settings_button_fullscreen", summary: "settings_button_fullscreen_desc" },
];

/** A whole-object selector would re-render on any setting, so this returns one flag per call. */
export function usePlayerButton(id: PlayerButtonId): boolean {
  const row = PLAYER_BUTTON_ROWS.find((candidate) => candidate.id === id);
  return useAppSettingsStore((state) => !row || state.values[row.setting] !== "false");
}
