import { SETTINGS } from "../settings/schema";
import { getSettingValue } from "../../store/useAppSettingsStore";
import { useCrossfadePauseStore } from "../../store/useCrossfadePauseStore";
import { chosenFadeSeconds, type CrossfadeSettings } from "./crossfade";

/** The crossfade settings now in force; a pause from the player's menu turns it off for the session. */
export function crossfadeSettings(): CrossfadeSettings {
  const enabled = getSettingValue(SETTINGS.MUSIC_CROSSFADE_ENABLED) === "true" && !useCrossfadePauseStore.getState().paused;
  return {
    seconds: chosenFadeSeconds(enabled, Number(getSettingValue(SETTINGS.MUSIC_CROSSFADE_SECONDS))),
    keepAlbums: getSettingValue(SETTINGS.MUSIC_CROSSFADE_KEEP_ALBUMS) === "true",
    onAutoAdvance: getSettingValue(SETTINGS.MUSIC_CROSSFADE_ON_AUTO_ADVANCE) === "true",
    onManualSkip: getSettingValue(SETTINGS.MUSIC_CROSSFADE_ON_SKIP) === "true",
  };
}
