import { builtInPreset, FLAT_PRESET_ID, isBuiltInPreset } from "./builtInPresets";
import { autoPreampDb, isBypassed, REFERENCE_SAMPLE_RATE } from "./filterMath";
import { GraphicEq, sanitizeCurve } from "./limits";
import {
  band,
  EQ_PROCESSING_OFF,
  EQ_STATE_VERSION,
  EqLimits,
  type EqBand,
  type EqCurve,
  type EqMode,
  type EqPreset,
  type EqProcessingSpec,
  type EqState,
  type EqWorkingCopy,
} from "./models";

/**
 * Every change the equalizer supports, as pure functions of `EqState`, ported from Android's
 * `EqStateOps.kt`. The store applies them and saves the result.
 */
export function defaultEqState(): EqState {
  return {
    version: EQ_STATE_VERSION,
    enabled: true,
    mode: "PARAMETRIC",
    parametric: { presetId: FLAT_PRESET_ID, curve: { preamp: 0, bands: [] } },
    graphic: { presetId: null, curve: GraphicEq.flatCurve() },
    autoPreamp: true,
    bassBoost: 0,
    userPresets: [],
  };
}

const bandsEqual = (a: EqBand, b: EqBand) =>
  a.frequency === b.frequency && a.gain === b.gain && a.q === b.q && a.type === b.type && a.enabled === b.enabled;

export const curvesEqual = (a: EqCurve, b: EqCurve): boolean =>
  a.preamp === b.preamp &&
  a.bands.length === b.bands.length &&
  a.bands.every((x, i) => {
    const y = b.bands[i];
    return y !== undefined && bandsEqual(x, y);
  });

const copiesEqual = (a: EqWorkingCopy, b: EqWorkingCopy) => a.presetId === b.presetId && curvesEqual(a.curve, b.curve);

const presetsEqual = (a: EqPreset, b: EqPreset) =>
  a.id === b.id && a.name === b.name && a.mode === b.mode && a.imported === b.imported && curvesEqual(a.curve, b.curve);

export const statesEqual = (a: EqState, b: EqState): boolean =>
  a.version === b.version &&
  a.enabled === b.enabled &&
  a.mode === b.mode &&
  copiesEqual(a.parametric, b.parametric) &&
  copiesEqual(a.graphic, b.graphic) &&
  a.autoPreamp === b.autoPreamp &&
  a.bassBoost === b.bassBoost &&
  a.userPresets.length === b.userPresets.length &&
  a.userPresets.every((p, i) => {
    const q = b.userPresets[i];
    return q !== undefined && presetsEqual(p, q);
  });

export const activeCopy = (state: EqState): EqWorkingCopy =>
  state.mode === "PARAMETRIC" ? state.parametric : state.graphic;

export const userPreset = (state: EqState, id: string | null | undefined): EqPreset | undefined =>
  id ? state.userPresets.find((p) => p.id === id) : undefined;

export const presetCurve = (state: EqState, id: string | null | undefined): EqCurve | undefined =>
  builtInPreset(id)?.curve ?? userPreset(state, id)?.curve;

const presetMode = (state: EqState, id: string | null | undefined): EqMode | undefined =>
  isBuiltInPreset(id) ? "PARAMETRIC" : userPreset(state, id)?.mode;

const defaultCurve = (mode: EqMode): EqCurve =>
  mode === "PARAMETRIC" ? { preamp: 0, bands: [] } : GraphicEq.flatCurve();

export function sanitizedFor(mode: EqMode, curve: EqCurve): EqCurve {
  return mode === "GRAPHIC"
    ? GraphicEq.curveOf(GraphicEq.gainsOf(curve), sanitizeCurve(curve).preamp)
    : sanitizeCurve(curve);
}

// Presets are immutable values, so a fit is reused for as long as its source curve lives.
const fits = new WeakMap<EqCurve, EqCurve>();
const fitted = (curve: EqCurve): EqCurve => {
  let fit = fits.get(curve);
  if (!fit) {
    fit = GraphicEq.fit(curve);
    fits.set(curve, fit);
  }
  return fit;
};

/**
 * Preset `id` as `mode` plays it: a graphic preset's ten bands load as parametric bands as they
 * are, and a parametric preset is fitted onto the ten graphic bands.
 */
export function presetCurveFor(state: EqState, mode: EqMode, id: string | null | undefined): EqCurve | undefined {
  const curve = presetCurve(state, id);
  if (!curve) return undefined;
  if (mode === "PARAMETRIC") return sanitizeCurve(curve);
  if (presetMode(state, id) === "GRAPHIC") return sanitizedFor("GRAPHIC", curve);
  return fitted(curve);
}

/** The curve differs from the preset it came from, or there is no preset and it is not flat. */
export function isEdited(state: EqState): boolean {
  const active = activeCopy(state);
  return !curvesEqual(active.curve, presetCurveFor(state, state.mode, active.presetId) ?? defaultCurve(state.mode));
}

/** The equalizer is on and something in it alters the signal. */
export function changesSound(state: EqState): boolean {
  const curve = activeCopy(state).curve;
  return (
    state.enabled &&
    (state.bassBoost > 0 ||
      curve.bands.some((b) => !isBypassed(b, REFERENCE_SAMPLE_RATE)) ||
      (!state.autoPreamp && curve.preamp !== 0))
  );
}

/** Save can overwrite the source preset only when it is one of the user's own. */
export function canSaveActive(state: EqState): boolean {
  return isEdited(state) && userPreset(state, activeCopy(state).presetId)?.mode === state.mode;
}

const withActive = (state: EqState, working: EqWorkingCopy): EqState =>
  state.mode === "PARAMETRIC" ? { ...state, parametric: working } : { ...state, graphic: working };

export const withActiveCurve = (state: EqState, curve: EqCurve): EqState =>
  withActive(state, { ...activeCopy(state), curve: sanitizedFor(state.mode, curve) });

/** Plays preset `id` in the current mode; the mode itself never changes here. */
export function selectPreset(state: EqState, id: string): EqState {
  const curve = presetCurveFor(state, state.mode, id);
  return curve ? withActive(state, { presetId: id, curve }) : state;
}

export const revert = (state: EqState): EqState =>
  withActiveCurve(state, presetCurveFor(state, state.mode, activeCopy(state).presetId) ?? defaultCurve(state.mode));

export function saveActive(state: EqState): EqState {
  if (!canSaveActive(state)) return state;
  const { presetId, curve } = activeCopy(state);
  return { ...state, userPresets: state.userPresets.map((p) => (p.id === presetId ? { ...p, curve } : p)) };
}

export function saveActiveAs(state: EqState, id: string, name: string): EqState {
  const curve = activeCopy(state).curve;
  const next = { ...state, userPresets: [...state.userPresets, { id, name, curve, mode: state.mode, imported: false }] };
  return withActive(next, { presetId: id, curve });
}

export const renamePreset = (state: EqState, id: string, name: string): EqState => ({
  ...state,
  userPresets: state.userPresets.map((p) => (p.id === id ? { ...p, name } : p)),
});

export function duplicatePreset(state: EqState, sourceId: string, newId: string, name: string): EqState {
  const curve = presetCurve(state, sourceId);
  const mode = presetMode(state, sourceId);
  if (!curve || !mode) return state;
  return { ...state, userPresets: [...state.userPresets, { id: newId, name, curve, mode, imported: false }] };
}

/** A deleted preset and where it was, so Undo can put it back in place. */
export interface DeletedEqPreset {
  preset: EqPreset;
  index: number;
  selectedIn: EqMode[];
}

export function deletePreset(state: EqState, id: string): [EqState, DeletedEqPreset | null] {
  const index = state.userPresets.findIndex((p) => p.id === id);
  const preset = state.userPresets[index];
  if (!preset) return [state, null];
  const selectedIn: EqMode[] = [];
  if (state.parametric.presetId === id) selectedIn.push("PARAMETRIC");
  if (state.graphic.presetId === id) selectedIn.push("GRAPHIC");
  const next: EqState = {
    ...state,
    userPresets: state.userPresets.filter((p) => p.id !== id),
    parametric: state.parametric.presetId === id ? { ...state.parametric, presetId: null } : state.parametric,
    graphic: state.graphic.presetId === id ? { ...state.graphic, presetId: null } : state.graphic,
  };
  return [next, { preset, index, selectedIn }];
}

export function restorePreset(state: EqState, deleted: DeletedEqPreset): EqState {
  if (userPreset(state, deleted.preset.id)) return state;
  const presets = [...state.userPresets];
  presets.splice(Math.max(0, Math.min(deleted.index, presets.length)), 0, deleted.preset);
  const id = deleted.preset.id;
  const reselect = (mode: EqMode, copy: EqWorkingCopy) =>
    deleted.selectedIn.includes(mode) && copy.presetId === null ? { ...copy, presetId: id } : copy;
  return {
    ...state,
    userPresets: presets,
    parametric: reselect("PARAMETRIC", state.parametric),
    graphic: reselect("GRAPHIC", state.graphic),
  };
}

export function importPreset(state: EqState, id: string, name: string, curve: EqCurve): EqState {
  const next: EqState = {
    ...state,
    mode: "PARAMETRIC",
    userPresets: [
      ...state.userPresets,
      { id, name, curve: sanitizeCurve(curve), mode: "PARAMETRIC", imported: true },
    ],
  };
  return selectPreset(next, id);
}

export const withBassBoost = (state: EqState, db: number): EqState => ({
  ...state,
  bassBoost: Math.max(0, Math.min(EqLimits.MAX_BASS_BOOST, db)),
});

export const withManualPreamp = (state: EqState, db: number): EqState =>
  withActiveCurve(state, { ...activeCopy(state).curve, preamp: db });

export function withBand(state: EqState, index: number, next: EqBand): EqState {
  const bands = activeCopy(state).curve.bands;
  if (index < 0 || index >= bands.length) return state;
  return withActiveCurve(state, { ...activeCopy(state).curve, bands: bands.map((b, i) => (i === index ? next : b)) });
}

export function addBand(state: EqState, next: EqBand): EqState {
  const curve = activeCopy(state).curve;
  if (state.mode !== "PARAMETRIC" || curve.bands.length >= EqLimits.MAX_BANDS) return state;
  return withActiveCurve(state, { ...curve, bands: [...curve.bands, next] });
}

export function removeBand(state: EqState, index: number): EqState {
  const curve = activeCopy(state).curve;
  if (state.mode !== "PARAMETRIC" || index < 0 || index >= curve.bands.length) return state;
  return withActiveCurve(state, { ...curve, bands: curve.bands.filter((_, i) => i !== index) });
}

export function insertBand(state: EqState, index: number, next: EqBand): EqState {
  const curve = activeCopy(state).curve;
  if (state.mode !== "PARAMETRIC" || curve.bands.length >= EqLimits.MAX_BANDS) return state;
  const bands = [...curve.bands];
  bands.splice(Math.max(0, Math.min(index, bands.length)), 0, next);
  return withActiveCurve(state, { ...curve, bands });
}

export const normalizedPresetName = (raw: string): string => raw.trim().slice(0, EqLimits.MAX_NAME_LENGTH);

/** True when `name` is free among the user's presets and the built-in names shown to them. */
export function isNameAvailable(
  state: EqState,
  name: string,
  builtInNames: readonly string[],
  exceptId?: string | null,
): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  if (!wanted) return false;
  const taken = [...state.userPresets.filter((p) => p.id !== exceptId).map((p) => p.name), ...builtInNames];
  return taken.every((n) => n.toLocaleLowerCase() !== wanted);
}

/**
 * What the audio graph should run. `preview` replaces the active curve while a point is dragged,
 * so the sound follows the pointer without the saved state changing every frame.
 */
export function processingSpec(state: EqState, bypass: boolean, preview?: EqCurve | null): EqProcessingSpec {
  if (!state.enabled || bypass) return EQ_PROCESSING_OFF;
  const curve = preview ?? activeCopy(state).curve;
  const bands = curve.bands.filter((b) => b.enabled);
  if (state.bassBoost > 0) {
    bands.push(band(EqLimits.BASS_BOOST_FREQUENCY, state.bassBoost, EqLimits.DEFAULT_SHELF_Q, "LOW_SHELF"));
  }
  const preampDb = state.autoPreamp ? autoPreampDb(bands) : curve.preamp;
  return { enabled: true, preampDb, bands };
}

/** Clamps every value and repairs anything a hand-edited backup or an old version could hold. */
export function sanitizeState(state: EqState): EqState {
  const seen = new Set<string>();
  return {
    ...state,
    parametric: { ...state.parametric, curve: sanitizeCurve(state.parametric.curve) },
    graphic: { ...state.graphic, curve: sanitizedFor("GRAPHIC", state.graphic.curve) },
    bassBoost: Number.isFinite(state.bassBoost) ? Math.max(0, Math.min(EqLimits.MAX_BASS_BOOST, state.bassBoost)) : 0,
    userPresets: state.userPresets
      .filter((p) => p.id.trim() !== "" && p.name.trim() !== "")
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .map((p) => ({ ...p, name: normalizedPresetName(p.name), curve: sanitizedFor(p.mode, p.curve) })),
  };
}
