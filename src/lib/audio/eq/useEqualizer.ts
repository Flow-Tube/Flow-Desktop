import { useMemo, useSyncExternalStore } from "react";

import { getString } from "../../i18n/index";
import { musicAudioEngine } from "../musicAudioEngine";
import { useEqStore } from "../../../store/useEqStore";
import { BUILT_IN_EQ_PRESETS, isBuiltInPreset } from "./builtInPresets";
import type { EqMode, EqState } from "./models";
import {
  activeCopy,
  canSaveActive,
  changesSound,
  isEdited,
  processingSpec,
  selectPreset,
  withWorkingCopy,
} from "./stateOps";

export interface EqPresetEntry {
  id: string;
  name: string;
  builtIn: boolean;
}

export const builtInPresetNames = (): string[] => BUILT_IN_EQ_PRESETS.map((p) => getString(p.nameKey));

/** Built-ins first, in Android's order, then the user's own. */
export function presetEntries(state: EqState): EqPresetEntry[] {
  return [
    ...BUILT_IN_EQ_PRESETS.map((p) => ({ id: p.id, name: getString(p.nameKey), builtIn: true })),
    ...state.userPresets.map((p) => ({ id: p.id, name: p.name, builtIn: false })),
  ];
}

export function presetName(state: EqState, id: string | null): string | null {
  if (!id) return null;
  return presetEntries(state).find((p) => p.id === id)?.name ?? null;
}

/**
 * Plays preset `id` in the current mode. An unsaved curve it replaces is kept as Custom, so
 * picking a preset never loses a curve the user tuned.
 */
export function pickEqPreset(id: string): void {
  const { state, update, setCustom } = useEqStore.getState();
  const active = activeCopy(state);
  if (active.presetId === id) return;
  // A flat curve with no preset is nothing to keep.
  if (isEdited(state)) setCustom(state.mode, active);
  update((s) => selectPreset(s, id));
}

/** Brings back the curve that was playing before a preset replaced it. */
export function restoreCustomEq(mode: EqMode): void {
  const { custom, update, setCustom } = useEqStore.getState();
  const copy = custom[mode];
  if (!copy) return;
  setCustom(mode, undefined);
  update((s) => (s.mode === mode ? withWorkingCopy(s, { presetId: null, curve: copy.curve }) : s));
}

/** The equalizer state the editor and the quick panel show, with what they derive from it. */
export function useEqualizer() {
  const state = useEqStore((s) => s.state);
  const preview = useEqStore((s) => s.preview);
  const custom = useEqStore((s) => s.custom[s.state.mode]);
  return useMemo(() => {
    const active = activeCopy(state);
    const spec = processingSpec({ ...state, enabled: true }, false, preview);
    return {
      state,
      active,
      /** What the graph draws: the curve being dragged, or the active one, with bass boost. */
      drawnBands: spec.bands,
      autoPreampDb: spec.preampDb,
      edited: isEdited(state),
      canSave: canSaveActive(state),
      changesSound: changesSound(state),
      hasCustom: !!custom || active.presetId === null,
      selectedIsUserPreset: !!active.presetId && !isBuiltInPreset(active.presetId),
      presets: presetEntries(state),
      activeName: presetName(state, active.presetId),
    };
  }, [state, preview, custom]);
}

/** Whether the equalizer is on and changes the sound, for the buttons that open it. */
export const useEqActive = (): boolean => useEqStore((s) => changesSound(s.state));

/** False when WebAudio failed for music, so the equalizer cannot be heard here. */
export function useMusicEqAvailable(): boolean {
  return useSyncExternalStore(
    (onChange) => musicAudioEngine.onEqAvailabilityChange(onChange),
    () => musicAudioEngine.isEqAvailable(),
  );
}
