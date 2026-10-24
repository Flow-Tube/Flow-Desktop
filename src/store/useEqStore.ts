import { create } from "zustand";

import { migrateLegacyEq, readLegacyEqConfig } from "../lib/audio/eq/legacyMigration";
import type { EqCurve, EqMode, EqState, EqWorkingCopy } from "../lib/audio/eq/models";
import { decodeEqState, encodeEqState } from "../lib/audio/eq/stateJson";
import { defaultEqState, sanitizeState, statesEqual } from "../lib/audio/eq/stateOps";
import { sanitizeCurve } from "../lib/audio/eq/limits";
import { SETTINGS } from "../lib/settings/schema";
import { setSettingValue, useAppSettingsStore } from "./useAppSettingsStore";

/** The stored value before anything was saved: the schema default. */
const UNSAVED = "{}";
const SAVE_DEBOUNCE_MS = 400;

interface EqStoreState {
  state: EqState;
  loaded: boolean;
  /** Plays in place of the active curve while a point is dragged; never saved. */
  preview: EqCurve | null;
  /** Held Compare: the players hear the unprocessed sound. Never saved. */
  bypass: boolean;
  editorOpen: boolean;
  /**
   * The unsaved curve each mode had before a preset replaced it, so it stays one click away as
   * Custom. Kept for the session: Android's saved state has no field for it.
   */
  custom: Partial<Record<EqMode, EqWorkingCopy>>;

  /** Applies `transform`; an edit made before the saved state loads is replayed on top of it. */
  update: (transform: (state: EqState) => EqState) => void;
  setCustom: (mode: EqMode, copy: EqWorkingCopy | undefined) => void;
  setPreview: (curve: EqCurve | null) => void;
  setBypass: (bypass: boolean) => void;
  setEditorOpen: (open: boolean) => void;
}

// The old desktop equalizer's gains, read before the music player rewrites its saved config.
const legacy = readLegacyEqConfig();

let earlyEdits: ((state: EqState) => EqState)[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// The value last written or adopted, so our own save is not read back as an outside change.
let lastJson: string | null = null;

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const json = encodeEqState(useEqStore.getState().state);
    if (json === lastJson) return;
    lastJson = json;
    void setSettingValue(SETTINGS.EQ_STATE_JSON, json);
  }, SAVE_DEBOUNCE_MS);
}

export const useEqStore = create<EqStoreState>((set, get) => ({
  state: defaultEqState(),
  loaded: false,
  preview: null,
  bypass: false,
  editorOpen: false,
  custom: {},

  update: (transform) => {
    const before = get().state;
    const after = sanitizeState(transform(before));
    if (!get().loaded) {
      earlyEdits.push(transform);
      set({ state: after });
      return;
    }
    if (statesEqual(after, before)) return;
    set({ state: after, preview: null });
    scheduleSave();
  },

  setCustom: (mode, copy) => set((s) => ({ custom: { ...s.custom, [mode]: copy } })),
  setPreview: (curve) => set({ preview: curve ? sanitizeCurve(curve) : null }),
  setBypass: (bypass) => set({ bypass }),
  setEditorOpen: (editorOpen) => set({ editorOpen }),
}));

/** Adopts the saved value, or the first-run migration of the old equalizer. */
function adopt(raw: string): void {
  if (raw === lastJson) return;
  const store = useEqStore.getState();
  let restored: EqState;
  let save = false;
  if (raw === UNSAVED && !store.loaded) {
    const migrated = migrateLegacyEq(legacy);
    restored = migrated ?? defaultEqState();
    save = migrated !== null;
  } else {
    // A value either app wrote; one that cannot be read leaves the current state alone.
    const decoded = decodeEqState(raw);
    if (!decoded) return;
    restored = decoded;
  }
  lastJson = raw;
  const edits = store.loaded ? [] : earlyEdits;
  earlyEdits = [];
  const state = edits.reduce((s, edit) => sanitizeState(edit(s)), restored);
  useEqStore.setState({ state, loaded: true, preview: null });
  if (save || edits.length > 0) scheduleSave();
}

let persistenceBound = false;

/**
 * Loads the equalizer once settings have loaded, and follows restores and syncs after that.
 * Music and every video player call it; it binds once per window.
 */
export function bindEqPersistence(): void {
  if (persistenceBound) return;
  persistenceBound = true;
  const follow = () => {
    const settings = useAppSettingsStore.getState();
    if (!settings.loaded) return;
    adopt(settings.values[SETTINGS.EQ_STATE_JSON] ?? UNSAVED);
  };
  follow();
  useAppSettingsStore.subscribe((settings, previous) => {
    if (settings.loaded !== previous.loaded || settings.values !== previous.values) follow();
  });
}
