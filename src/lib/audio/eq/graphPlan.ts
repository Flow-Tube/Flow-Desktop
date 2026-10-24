import { isBypassed } from "./filterMath";
import { EqLimits, type EqBand, type EqCurve, type EqState } from "./models";
import { processingSpec } from "./stateOps";

/** Filters in the WebAudio chain. Unused ones sit flat, so adding a band never rewires the graph. */
export const EQ_FILTER_POOL = EqLimits.MAX_BANDS;

/** What one player's equalizer chain runs: the curve, bass boost on its own shelf, and the preamp. */
export interface EqGraphSpec {
  enabled: boolean;
  preampDb: number;
  bands: EqBand[];
  bassBoostDb: number;
}

export const EQ_GRAPH_OFF: EqGraphSpec = { enabled: false, preampDb: 0, bands: [], bassBoostDb: 0 };

/**
 * The chain's settings for `state`. The preamp is Android's `processingSpec`, so auto preamp
 * counts bass boost; bass boost is split off again because it has its own filter.
 */
export function graphSpec(state: EqState, bypass: boolean, preview?: EqCurve | null): EqGraphSpec {
  const spec = processingSpec(state, bypass, preview);
  if (!spec.enabled) return EQ_GRAPH_OFF;
  const boosted = state.bassBoost > 0;
  return {
    enabled: true,
    preampDb: spec.preampDb,
    bands: boosted ? spec.bands.slice(0, -1) : spec.bands,
    bassBoostDb: boosted ? state.bassBoost : 0,
  };
}

/** Whether running `spec` sounds different from not running it. */
export function graphChangesSound(spec: EqGraphSpec, sampleRate: number): boolean {
  return (
    spec.enabled &&
    (spec.preampDb !== 0 || spec.bassBoostDb > 0 || spec.bands.some((b) => !isBypassed(b, sampleRate)))
  );
}

export interface FilterSetting {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gain: number;
}

/**
 * One BiquadFilterNode's settings for `band`, or null for a pool slot that should sit flat.
 * WebAudio's shelves have no Q (they are always Butterworth), and its low and high pass take Q in
 * dB, which is 20·log10 of the RBJ Q every other part of the model uses.
 */
export function filterSetting(band: EqBand | undefined, sampleRate: number): FilterSetting | null {
  if (!band || isBypassed(band, sampleRate)) return null;
  switch (band.type) {
    case "PEAK":
      return { type: "peaking", frequency: band.frequency, q: band.q, gain: band.gain };
    case "LOW_SHELF":
      return { type: "lowshelf", frequency: band.frequency, q: 1, gain: band.gain };
    case "HIGH_SHELF":
      return { type: "highshelf", frequency: band.frequency, q: 1, gain: band.gain };
    case "LOW_PASS":
      return { type: "lowpass", frequency: band.frequency, q: 20 * Math.log10(band.q), gain: 0 };
    case "HIGH_PASS":
      return { type: "highpass", frequency: band.frequency, q: 20 * Math.log10(band.q), gain: 0 };
  }
}

/** Whether a shelf in `curve` plays differently in WebAudio than its stored Q says. */
export const hasNonButterworthShelf = (curve: EqCurve): boolean =>
  curve.bands.some(
    (b) => (b.type === "LOW_SHELF" || b.type === "HIGH_SHELF") && Math.abs(b.q - EqLimits.DEFAULT_SHELF_Q) > 0.01,
  );
