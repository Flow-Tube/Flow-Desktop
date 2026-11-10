import { create } from "zustand";

import { NO_NEW_SETTINGS, newSettings, recordKnownSettings, settingKeys, type NewSettings } from "../lib/settings/newSettings";
import { SETTINGS_INDEX } from "../lib/settings/settingsIndex";
import { profileStorage } from "../lib/storage/profileStorage";

const STORAGE_KEY = "flow_settings_first_seen";
const DAY_MS = 24 * 60 * 60 * 1000;

function loadFirstSeen(): Record<string, number> | null {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : null;
  } catch {
    return null;
  }
}

interface NewSettingsState extends NewSettings {
  /** Notes settings seen for the first time and works out which ones get a dot. */
  refresh: (enabled: boolean, days: number) => void;
}

export const useNewSettingsStore = create<NewSettingsState>((set) => ({
  ...NO_NEW_SETTINGS,
  refresh: (enabled, days) => {
    const today = Math.floor(Date.now() / DAY_MS);
    const firstSeen = recordKnownSettings(loadFirstSeen(), settingKeys(), today);
    try {
      profileStorage.setItem(STORAGE_KEY, JSON.stringify(firstSeen));
    } catch {
      // A blocked store only means the dots start over next time.
    }
    set(enabled ? newSettings(firstSeen, SETTINGS_INDEX, today, days) : NO_NEW_SETTINGS);
  },
}));
