import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

/** Whether YouTube Music shows at all: every music surface answers to this one switch. */
export function useMusicEnabled(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.MUSIC_CONTENT_ENABLED] !== "false");
}

/** The same answer for code outside a render. */
export function musicEnabledNow(): boolean {
  return useAppSettingsStore.getState().values[SETTINGS.MUSIC_CONTENT_ENABLED] !== "false";
}

/** A list as it shows with the Show Music switch where it is: songs leave, videos stay. */
export function withMusic<T extends { isMusic?: boolean }>(items: T[], musicEnabled: boolean): T[] {
  return musicEnabled ? items : items.filter((item) => !item.isMusic);
}
