import { useEffect } from "react";
import { SETTINGS } from "./settings/schema";
import { getSettingValue, setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Keeps the Settings-page subtitle font scale / bold values and the in-player
 * subtitle style in step, in both directions — but only on actual changes.
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
  const fontScaleSetting = useAppSettingsStore(
    (state) => state.values[SETTINGS.SUBTITLE_FONT_SCALE] ?? "100",
  );
  const bold = useAppSettingsStore((state) => state.values[SETTINGS.SUBTITLE_BOLD] !== "false");

  useEffect(() => {
    // Settings hydrate asynchronously from SQLite; reacting to the
    // defaults->stored transition would clobber the persisted style on launch.
    if (!settingsLoaded) return;

    const parsed = Number(fontScaleSetting);
    const fontScale = Number.isFinite(parsed) ? parsed : 100;
    const key = `${fontScale}|${bold}`;
    if (lastAppliedSettingsKey === key) return;

    const isFirstObservation = lastAppliedSettingsKey === null;
    lastAppliedSettingsKey = key;
    // First observation is baseline capture, not a user change of the setting.
    if (isFirstObservation) return;

    const { subtitleStyle, setSubtitleStyle } = usePlayerStore.getState();
    if (subtitleStyle.fontScale === fontScale && subtitleStyle.isBold === bold) return;
    setSubtitleStyle({ ...subtitleStyle, fontScale, isBold: bold });
  }, [bold, fontScaleSetting, settingsLoaded]);

  // Changes made in the player (customizer, +/- keys) are saved to the settings too, so the Settings
  // page shows them. Only on a change, so launching never writes over the stored settings.
  useEffect(
    () =>
      usePlayerStore.subscribe((state, previous) => {
        const style = state.subtitleStyle;
        if (style === previous.subtitleStyle || !useAppSettingsStore.getState().loaded) return;
        const values = [
          [SETTINGS.SUBTITLE_FONT_SCALE, String(style.fontScale)],
          [SETTINGS.SUBTITLE_BOLD, String(style.isBold)],
        ] as const;
        for (const [key, value] of values) {
          if (getSettingValue(key) !== value) void setSettingValue(key, value);
        }
      }),
    [],
  );
}
