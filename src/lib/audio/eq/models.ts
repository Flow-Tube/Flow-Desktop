/**
 * The equalizer model shared with Flow for Android (`data/audio/eq/EqModels.kt`). The field names
 * and enum spellings are the JSON both apps store and sync, so they must not be renamed.
 */
export type EqFilterType = "PEAK" | "LOW_SHELF" | "HIGH_SHELF" | "LOW_PASS" | "HIGH_PASS";

export const EQ_FILTER_TYPES: readonly EqFilterType[] = ["PEAK", "LOW_SHELF", "HIGH_SHELF", "LOW_PASS", "HIGH_PASS"];

/** The EqualizerAPO code each type is written with. */
export const APO_CODES: Record<EqFilterType, string> = {
  PEAK: "PK",
  LOW_SHELF: "LSC",
  HIGH_SHELF: "HSC",
  LOW_PASS: "LPQ",
  HIGH_PASS: "HPQ",
};

export const hasGain = (type: EqFilterType): boolean =>
  type === "PEAK" || type === "LOW_SHELF" || type === "HIGH_SHELF";

export interface EqBand {
  frequency: number;
  gain: number;
  q: number;
  type: EqFilterType;
  enabled: boolean;
}

export const EqLimits = {
  MIN_FREQUENCY: 20,
  MAX_FREQUENCY: 20_000,
  MIN_GAIN: -24,
  MAX_GAIN: 24,
  MIN_Q: 0.1,
  MAX_Q: 20,
  MIN_PREAMP: -24,
  MAX_PREAMP: 24,
  MAX_BANDS: 20,
  MAX_BASS_BOOST: 15,
  DEFAULT_PEAK_Q: 1.41,
  /** Butterworth Q: the slope WebAudio's shelves always have, whatever Q they are given. */
  DEFAULT_SHELF_Q: 0.707,
  BASS_BOOST_FREQUENCY: 60,
  MAX_NAME_LENGTH: 40,
} as const;

export const defaultQ = (type: EqFilterType): number =>
  type === "PEAK" ? EqLimits.DEFAULT_PEAK_Q : EqLimits.DEFAULT_SHELF_Q;

/** A band with Android's defaults for whatever is left out. */
export function band(
  frequency: number,
  gain = 0,
  q: number = EqLimits.DEFAULT_PEAK_Q,
  type: EqFilterType = "PEAK",
  enabled = true,
): EqBand {
  return { frequency, gain, q, type, enabled };
}
