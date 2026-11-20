import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";
import { parseChord } from "./chord";

/** The keys a person picked for a command, by command id. An empty list leaves the command unbound. */
export type ShortcutOverrides = Readonly<Record<string, readonly string[]>>;

export interface ShortcutSettings {
  overrides: ShortcutOverrides;
  /** Off: keys without Ctrl, Alt or Cmd that type a character do nothing, for speech input (WCAG 2.1.4). */
  singleKeys: boolean;
}

export const NO_OVERRIDES: ShortcutOverrides = Object.freeze({});
export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = Object.freeze({ overrides: NO_OVERRIDES, singleKeys: true });

/** Reads the saved JSON, dropping anything that isn't a list of chords. */
export function parseOverrides(raw: string | undefined): ShortcutOverrides {
  if (!raw) return NO_OVERRIDES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NO_OVERRIDES;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NO_OVERRIDES;
  const overrides: Record<string, readonly string[]> = {};
  for (const [id, keys] of Object.entries(value)) {
    if (Array.isArray(keys) && keys.every((key) => typeof key === "string" && parseChord(key))) overrides[id] = keys;
  }
  return Object.keys(overrides).length > 0 ? overrides : NO_OVERRIDES;
}

let cached: { raw: string | undefined; singleKeys: boolean; settings: ShortcutSettings } | null = null;

function settingsFrom(raw: string | undefined, singleKeysRaw: string | undefined): ShortcutSettings {
  const singleKeys = singleKeysRaw !== "false";
  // One object per saved value, so the matcher's chord index is built once per change, not per key.
  if (cached && cached.raw === raw && cached.singleKeys === singleKeys) return cached.settings;
  const overrides = parseOverrides(raw);
  const settings =
    overrides === NO_OVERRIDES && singleKeys ? DEFAULT_SHORTCUT_SETTINGS : Object.freeze({ overrides, singleKeys });
  cached = { raw, singleKeys, settings };
  return settings;
}

/** The keys in force now, for listeners outside React. */
export function currentShortcutSettings(): ShortcutSettings {
  const values = useAppSettingsStore.getState().values;
  return settingsFrom(values[SETTINGS.KEYBOARD_BINDINGS], values[SETTINGS.SINGLE_KEY_SHORTCUTS_ENABLED]);
}

export function useShortcutSettings(): ShortcutSettings {
  const raw = useAppSettingsStore((state) => state.values[SETTINGS.KEYBOARD_BINDINGS]);
  const singleKeys = useAppSettingsStore((state) => state.values[SETTINGS.SINGLE_KEY_SHORTCUTS_ENABLED]);
  return settingsFrom(raw, singleKeys);
}

/** `overrides` with one command's keys replaced, or put back to its defaults with `null`. */
export function withCommandKeys(overrides: ShortcutOverrides, id: string, keys: readonly string[] | null): ShortcutOverrides {
  const next: Record<string, readonly string[]> = { ...overrides };
  if (keys === null) delete next[id];
  else next[id] = keys;
  return next;
}

export function saveOverrides(overrides: ShortcutOverrides): Promise<boolean> {
  return useAppSettingsStore.getState().setSettingValue(SETTINGS.KEYBOARD_BINDINGS, JSON.stringify(overrides));
}
