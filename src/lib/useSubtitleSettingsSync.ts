import { useEffect } from "react";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Applies the Settings-page subtitle font size / bold values onto the
 * in-player subtitle style — but only when those settings actually change.
 *
 * The in-player customizer (SubtitleCustomizer -> setSubtitleStyle, persisted
 * to localStorage) is the live source of truth. Keying this sync on the
 * current style, as the old per-component effects did, instantly reverted any
 * slider change back to the stored setting; and with two player surfaces
 * mounted the copies fought each other. The last-applied key is module-level
 * for the same reason: one applied change must not be re-applied by the next
 * surface to mount.
 */
let lastAppliedSettingsKey: string | null = null;

export function useSubtitleSettingsSync() {
  const settingsLoaded = useAppSettingsStore((state) => state.loaded);
  const fontSizeSetting = useAppSettingsStore(
    (state) => state.values[SETTINGS.SUBTITLE_FONT_SIZE] ?? "14",
  );
  const bold = useAppSettingsStore((state) => state.values[SETTINGS.SUBTITLE_BOLD] !== "false");

  useEffect(() => {
    // Settings hydrate asynchronously from SQLite; reacting to the
    // defaults->stored transition would clobber the persisted style on launch.
    if (!settingsLoaded) return;

    const parsed = Number(fontSizeSetting);
    const fontSize = Number.isFinite(parsed) ? parsed : 14;
    const key = `${fontSize}|${bold}`;
    if (lastAppliedSettingsKey === key) return;

    const isFirstObservation = lastAppliedSettingsKey === null;
    lastAppliedSettingsKey = key;
    // First observation is baseline capture, not a user change of the setting.
    if (isFirstObservation) return;

    const { subtitleStyle, setSubtitleStyle } = usePlayerStore.getState();
    if (subtitleStyle.fontSize === fontSize && subtitleStyle.isBold === bold) return;
    setSubtitleStyle({ ...subtitleStyle, fontSize, isBold: bold });
  }, [bold, fontSizeSetting, settingsLoaded]);
}
