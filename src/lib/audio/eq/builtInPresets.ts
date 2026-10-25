import type { StringKey } from "../../i18n/index";
import { band, EqLimits, type EqBand, type EqCurve } from "./models";

export interface BuiltInEqPreset {
  id: string;
  nameKey: StringKey;
  curve: EqCurve;
}

/**
 * The presets Flow ships, with Android's stable ids (`BuiltInEqPresets.kt`), so a preset picked on
 * one device is the same preset on the other. Shelves use the Butterworth Q.
 */
export const FLAT_PRESET_ID = "builtin:flat";

const SHELF_Q = EqLimits.DEFAULT_SHELF_Q;

const preset = (key: string, nameKey: StringKey, preamp: number, ...bands: EqBand[]): BuiltInEqPreset => ({
  id: `builtin:${key}`,
  nameKey,
  curve: { preamp, bands },
});

export const BUILT_IN_EQ_PRESETS: readonly BuiltInEqPreset[] = [
  { id: FLAT_PRESET_ID, nameKey: "eq_preset_flat", curve: { preamp: 0, bands: [] } },
  preset(
    "acoustic",
    "eq_preset_acoustic",
    0,
    band(100, 2, 0.7, "PEAK"),
    band(400, -1, 1, "PEAK"),
    band(2_000, 1.5, 1, "PEAK"),
    band(6_000, 3, SHELF_Q, "HIGH_SHELF"),
  ),
  preset("bass_boost", "eq_preset_bass_boost", 0, band(60, 9, SHELF_Q, "LOW_SHELF"), band(200, 3, 0.7, "PEAK")),
  preset(
    "classical",
    "eq_preset_classical",
    0,
    band(100, 3, SHELF_Q, "LOW_SHELF"),
    band(500, -2, 1, "PEAK"),
    band(2_500, 2, 1, "PEAK"),
    band(10_000, 3, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "electronic",
    "eq_preset_electronic",
    -1,
    band(50, 7, SHELF_Q, "LOW_SHELF"),
    band(400, -1, 1, "PEAK"),
    band(2_000, 2.5, 1, "PEAK"),
    band(8_000, 5, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "heavy_metal",
    "eq_preset_heavy_metal",
    -1,
    band(60, 6, SHELF_Q, "LOW_SHELF"),
    band(250, 2, 1, "PEAK"),
    band(700, -3, 1, "PEAK"),
    band(2_000, 1, 1, "PEAK"),
    band(4_000, 4, 1, "PEAK"),
    band(10_000, 5, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "hip_hop",
    "eq_preset_hip_hop",
    -1,
    band(55, 8, SHELF_Q, "LOW_SHELF"),
    band(250, 2, 1, "PEAK"),
    band(1_000, -2, 1, "PEAK"),
    band(5_000, 3, 1, "PEAK"),
  ),
  preset(
    "jazz",
    "eq_preset_jazz",
    0,
    band(100, 2, SHELF_Q, "LOW_SHELF"),
    band(500, -1, 1, "PEAK"),
    band(2_500, 1.5, 1, "PEAK"),
    band(10_000, 2, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "metal",
    "eq_preset_metal",
    0,
    band(60, 4, SHELF_Q, "LOW_SHELF"),
    band(300, 3, 1.41, "PEAK"),
    band(1_500, 2, 1, "PEAK"),
    band(4_000, 4, 1, "PEAK"),
  ),
  preset(
    "pop",
    "eq_preset_pop",
    0,
    band(100, 4, 0.7, "PEAK"),
    band(2_500, 2.5, 1, "PEAK"),
    band(12_000, 3.5, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "rnb",
    "eq_preset_rnb",
    0,
    band(70, 6, SHELF_Q, "LOW_SHELF"),
    band(300, -2, 1, "PEAK"),
    band(1_200, -1.5, 1, "PEAK"),
    band(4_000, 2, 1, "PEAK"),
  ),
  preset(
    "rock",
    "eq_preset_rock",
    0,
    band(60, 5, SHELF_Q, "LOW_SHELF"),
    band(230, 3, 1, "PEAK"),
    band(910, -2, 1, "PEAK"),
    band(3_600, 3.5, 1, "PEAK"),
    band(14_000, 5, SHELF_Q, "HIGH_SHELF"),
  ),
  preset(
    "vocal",
    "eq_preset_vocal",
    0,
    band(100, -2, SHELF_Q, "LOW_SHELF"),
    band(1_000, 3, 2, "PEAK"),
    band(5_000, 2, 1, "PEAK"),
  ),
];

const BY_ID = new Map(BUILT_IN_EQ_PRESETS.map((p) => [p.id, p]));

export const builtInPreset = (id: string | null | undefined): BuiltInEqPreset | undefined =>
  id ? BY_ID.get(id) : undefined;

export const isBuiltInPreset = (id: string | null | undefined): boolean => !!id && BY_ID.has(id);
