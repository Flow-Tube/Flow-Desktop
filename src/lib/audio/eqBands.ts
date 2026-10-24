import { band, EqLimits, type EqBand } from "./eq/models";

export interface EqBandConfig {
  frequency: number;
  type: BiquadFilterType;
  label: string;
}

export const EQ_BANDS: EqBandConfig[] = [
  { frequency: 32, type: "lowshelf", label: "32" },
  { frequency: 64, type: "peaking", label: "64" },
  { frequency: 125, type: "peaking", label: "125" },
  { frequency: 250, type: "peaking", label: "250" },
  { frequency: 500, type: "peaking", label: "500" },
  { frequency: 1000, type: "peaking", label: "1K" },
  { frequency: 2000, type: "peaking", label: "2K" },
  { frequency: 4000, type: "peaking", label: "4K" },
  { frequency: 8000, type: "peaking", label: "8K" },
  { frequency: 16000, type: "highshelf", label: "16K" },
];

export const EQ_BAND_COUNT = EQ_BANDS.length;

/** Quality factor for the peaking bands. ~1.4 gives smooth, musical overlap. */
export const EQ_PEAKING_Q = 1.41;

/** Maximum boost/cut per band, in dB (slider range is ±this). */
export const EQ_MAX_GAIN_DB = 12;

/** A flat (0 dB everywhere) curve — the neutral default. */
export const EQ_FLAT: number[] = EQ_BANDS.map(() => 0);

export type EqPresetName =
  | "flat"
  | "bass"
  | "vocal"
  | "treble"
  | "electronic"
  | "acoustic";

// Preset gains are ordered low → high to match EQ_BANDS exactly.
export const EQ_PRESETS: Record<EqPresetName, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 1, 2],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 2, 0, -1],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  electronic: [5, 4, 1, 0, -1, 1, 0, 2, 3, 4],
  acoustic: [3, 2, 1, 1, 2, 2, 3, 3, 2, 1],
};

// Clamp an arbitrary gains array to exactly EQ_BAND_COUNT entries in range.
export function normalizeEqGains(gains: number[] | null | undefined): number[] {
  const clampDb = (n: number) =>
    Math.max(-EQ_MAX_GAIN_DB, Math.min(EQ_MAX_GAIN_DB, Number.isFinite(n) ? n : 0));
  return EQ_BANDS.map((_, i) => clampDb(gains?.[i] ?? 0));
}

/**
 * The curve `gains` plays, in the shared EQ model. WebAudio's shelves ignore Q and always have the
 * Butterworth slope, so they are modelled at that Q.
 */
export function eqCurveBands(gains: readonly number[]): EqBand[] {
  return EQ_BANDS.map((config, i) =>
    config.type === "peaking"
      ? band(config.frequency, gains[i] ?? 0, EQ_PEAKING_Q, "PEAK")
      : band(
          config.frequency,
          gains[i] ?? 0,
          EqLimits.DEFAULT_SHELF_Q,
          config.type === "lowshelf" ? "LOW_SHELF" : "HIGH_SHELF",
        ),
  );
}
