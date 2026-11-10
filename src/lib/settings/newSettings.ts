import { SETTINGS_INDEX, type SettingEntry, type SettingsCategory } from "./settingsIndex";

type FirstSeen = Record<string, number>;

/** The day settings that existed before this feature are recorded with, far enough back to never be new. */
const ALWAYS_KNOWN = 0;

/**
 * Which settings are new. Flow notices a setting it hasn't seen on its own, so nothing is tagged per
 * release: the first run marks everything as always known, and a setting that appears in a later
 * build is new for a number of days from the day it was first seen. Same rule as Flow for Android.
 */
export function recordKnownSettings(known: FirstSeen | null, keys: string[], today: number): FirstSeen {
  const recorded: FirstSeen = {};
  for (const key of keys) recorded[key] = known === null ? ALWAYS_KNOWN : (known[key] ?? today);
  return recorded;
}

export interface NewSettings {
  titles: ReadonlySet<string>;
  categories: ReadonlySet<SettingsCategory>;
}

export const NO_NEW_SETTINGS: NewSettings = { titles: new Set(), categories: new Set() };

export function newSettings(firstSeen: FirstSeen, entries: SettingEntry[], today: number, days: number): NewSettings {
  const fresh = entries.filter((entry) => {
    const seen = firstSeen[entry.title];
    return seen !== undefined && today - seen < days;
  });
  return {
    titles: new Set(fresh.map((entry) => entry.title)),
    categories: new Set(fresh.map((entry) => entry.category)),
  };
}

export const settingKeys = () => SETTINGS_INDEX.map((entry) => entry.title);
