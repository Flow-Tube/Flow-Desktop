import {
  EQ_FILTER_TYPES,
  EqLimits,
  type EqBand,
  type EqCurve,
  type EqFilterType,
  type EqMode,
  type EqPreset,
  type EqState,
  type EqWorkingCopy,
} from "./models";
import { defaultEqState, sanitizeState } from "./stateOps";

/*
 * The equalizer as one JSON value: the form it is saved in, backed up and synced as. It is the
 * schema Android's `EqStateJson` writes with kotlinx.serialization, so either app reads the
 * other's. Like Android, a value that does not fit the schema is rejected whole rather than
 * half-applied, and missing fields take their defaults.
 */
class Invalid extends Error {}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function field<T>(obj: Json, key: string, read: (v: unknown) => T, fallback: () => T): T {
  if (!(key in obj)) return fallback();
  return read(obj[key]);
}

const num = (v: unknown): number => {
  if (typeof v !== "number") throw new Invalid();
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw new Invalid();
  return v;
};
const str = (v: unknown): string => {
  if (typeof v !== "string") throw new Invalid();
  return v;
};
const filterType = (v: unknown): EqFilterType => {
  if (!EQ_FILTER_TYPES.includes(v as EqFilterType)) throw new Invalid();
  return v as EqFilterType;
};
const mode = (v: unknown): EqMode => {
  if (v !== "PARAMETRIC" && v !== "GRAPHIC") throw new Invalid();
  return v;
};
const list = <T>(read: (v: unknown) => T) => (v: unknown): T[] => {
  if (!Array.isArray(v)) throw new Invalid();
  return v.map(read);
};
const object = (v: unknown): Json => {
  if (!isObject(v)) throw new Invalid();
  return v;
};

function readBand(v: unknown): EqBand {
  const o = object(v);
  if (!("frequency" in o)) throw new Invalid();
  return {
    frequency: num(o.frequency),
    gain: field(o, "gain", num, () => 0),
    q: field(o, "q", num, () => EqLimits.DEFAULT_PEAK_Q),
    type: field(o, "type", filterType, () => "PEAK" as const),
    enabled: field(o, "enabled", bool, () => true),
  };
}

function readCurve(v: unknown): EqCurve {
  const o = object(v);
  return {
    preamp: field(o, "preamp", num, () => 0),
    bands: field(o, "bands", list(readBand), () => []),
  };
}

function readCopy(v: unknown): EqWorkingCopy {
  const o = object(v);
  if (!("curve" in o)) throw new Invalid();
  const presetId = o.presetId;
  if (presetId !== undefined && presetId !== null && typeof presetId !== "string") throw new Invalid();
  return { presetId: presetId ?? null, curve: readCurve(o.curve) };
}

function readPreset(v: unknown): EqPreset {
  const o = object(v);
  if (!("id" in o) || !("name" in o) || !("curve" in o)) throw new Invalid();
  return {
    id: str(o.id),
    name: str(o.name),
    curve: readCurve(o.curve),
    mode: field(o, "mode", mode, () => "PARAMETRIC" as const),
    imported: field(o, "imported", bool, () => false),
  };
}

/** Null when `raw` is not an equalizer state either app wrote. */
export function decodeEqState(raw: string): EqState | null {
  try {
    const o = object(JSON.parse(raw));
    const defaults = defaultEqState();
    return sanitizeState({
      version: field(o, "version", num, () => defaults.version),
      enabled: field(o, "enabled", bool, () => defaults.enabled),
      mode: field(o, "mode", mode, () => defaults.mode),
      parametric: field(o, "parametric", readCopy, () => defaults.parametric),
      graphic: field(o, "graphic", readCopy, () => defaults.graphic),
      autoPreamp: field(o, "autoPreamp", bool, () => defaults.autoPreamp),
      bassBoost: field(o, "bassBoost", num, () => defaults.bassBoost),
      userPresets: field(o, "userPresets", list(readPreset), () => defaults.userPresets),
    });
  } catch {
    return null;
  }
}

/** Every field written, in Android's order, as kotlinx's `encodeDefaults` does. */
export function encodeEqState(state: EqState): string {
  const curve = (c: EqCurve) => ({
    preamp: c.preamp,
    bands: c.bands.map((b) => ({ frequency: b.frequency, gain: b.gain, q: b.q, type: b.type, enabled: b.enabled })),
  });
  const copy = (c: EqWorkingCopy) => ({ presetId: c.presetId, curve: curve(c.curve) });
  return JSON.stringify({
    version: state.version,
    enabled: state.enabled,
    mode: state.mode,
    parametric: copy(state.parametric),
    graphic: copy(state.graphic),
    autoPreamp: state.autoPreamp,
    bassBoost: state.bassBoost,
    userPresets: state.userPresets.map((p) => ({
      id: p.id,
      name: p.name,
      curve: curve(p.curve),
      mode: p.mode,
      imported: p.imported,
    })),
  });
}

export const newPresetId = (): string => `user:${crypto.randomUUID()}`;
