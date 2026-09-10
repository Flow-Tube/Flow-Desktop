import { useEffect, useRef } from "react";

import { SETTINGS } from "./settings/schema";
import { getSettingValue, setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

const PERSIST_DEBOUNCE_MS = 300;

/**
 * Keeps the player volume and mute in SQLite so they survive a restart, and so
 * the pop-out window — a second webview with its own store — opens at the level
 * the main window was playing at rather than at the store default.
 */
export function usePersistedPlayerVolume(): void {
  const settingsLoaded = useAppSettingsStore((state) => state.loaded);
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !settingsLoaded) return;
    hydratedRef.current = true;
    const storedVolume = Number(getSettingValue(SETTINGS.PLAYER_VOLUME));
    const store = usePlayerStore.getState();
    if (Number.isFinite(storedVolume)) store.setVolume(storedVolume);
    store.setMuted(getSettingValue(SETTINGS.PLAYER_MUTED) === "true");
  }, [settingsLoaded]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      void setSettingValue(SETTINGS.PLAYER_VOLUME, String(volume));
      void setSettingValue(SETTINGS.PLAYER_MUTED, String(muted));
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [muted, volume]);
}
