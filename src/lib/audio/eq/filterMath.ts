import { EqLimits, hasGain, type EqBand } from "./models";

/**
 * Biquad design from Robert Bristow-Johnson's Audio EQ Cookbook, in the Q form EqualizerAPO and
 * AutoEQ use for every type, shelves included. Ported from Android's `EqFilterMath.kt`: the
 * response graph and auto preamp read these coefficients on both apps, so a curve draws and
 * protects its peak the same way everywhere.
 */
export const REFERENCE_SAMPLE_RATE = 48_000;

const NYQUIST_MARGIN = 0.49;
const RESPONSE_POINTS = 256;

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** A band that would not change the signal, or that sits above what `sampleRate` can carry. */
export function isBypassed(band: EqBand, sampleRate: number): boolean {
  return (
    !band.enabled ||
    (hasGain(band.type) && band.gain === 0) ||
    band.frequency >= sampleRate * NYQUIST_MARGIN
  );
}

/** b0, b1, b2, a1, a2 for `band`, normalised by a0. */
export function design(band: EqBand, sampleRate: number): BiquadCoefficients {
  const w = (2 * Math.PI * band.frequency) / sampleRate;
  const cosW = Math.cos(w);
  const alpha = Math.sin(w) / (2 * band.q);
  const a = Math.pow(10, band.gain / 40);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  switch (band.type) {
    case "PEAK":
      b0 = 1 + alpha * a;
      b1 = -2 * cosW;
      b2 = 1 - alpha * a;
      a0 = 1 + alpha / a;
      a1 = -2 * cosW;
      a2 = 1 - alpha / a;
      break;
    case "LOW_SHELF": {
      const k = 2 * Math.sqrt(a) * alpha;
      b0 = a * (a + 1 - (a - 1) * cosW + k);
      b1 = 2 * a * (a - 1 - (a + 1) * cosW);
      b2 = a * (a + 1 - (a - 1) * cosW - k);
      a0 = a + 1 + (a - 1) * cosW + k;
      a1 = -2 * (a - 1 + (a + 1) * cosW);
      a2 = a + 1 + (a - 1) * cosW - k;
      break;
    }
    case "HIGH_SHELF": {
      const k = 2 * Math.sqrt(a) * alpha;
      b0 = a * (a + 1 + (a - 1) * cosW + k);
      b1 = -2 * a * (a - 1 + (a + 1) * cosW);
      b2 = a * (a + 1 + (a - 1) * cosW - k);
      a0 = a + 1 - (a - 1) * cosW + k;
      a1 = 2 * (a - 1 - (a + 1) * cosW);
      a2 = a + 1 - (a - 1) * cosW - k;
      break;
    }
    case "LOW_PASS":
      b0 = (1 - cosW) / 2;
      b1 = 1 - cosW;
      b2 = (1 - cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
      break;
    case "HIGH_PASS":
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW;
      a2 = 1 - alpha;
      break;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** The level, in dB, the active bands of `bands` apply at `frequency`, without preamp. */
export function magnitudeDb(
  bands: readonly EqBand[],
  frequency: number,
  sampleRate: number = REFERENCE_SAMPLE_RATE,
): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let total = 0;
  for (const band of bands) {
    if (isBypassed(band, sampleRate)) continue;
    const c = design(band, sampleRate);
    const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
    const ni = -(c.b1 * s1 + c.b2 * s2);
    const dr = 1 + c.a1 * c1 + c.a2 * c2;
    const di = -(c.a1 * s1 + c.a2 * s2);
    total += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return total;
}

/** Position 0..1 on a log axis from 20 Hz to 20 kHz. */
export function frequencyAt(fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  return EqLimits.MIN_FREQUENCY * Math.pow(EqLimits.MAX_FREQUENCY / EqLimits.MIN_FREQUENCY, f);
}

export function fractionOf(frequency: number): number {
  const f = Math.max(EqLimits.MIN_FREQUENCY, Math.min(EqLimits.MAX_FREQUENCY, frequency));
  return Math.log10(f / EqLimits.MIN_FREQUENCY) / Math.log10(EqLimits.MAX_FREQUENCY / EqLimits.MIN_FREQUENCY);
}

/** The highest level the curve reaches between 20 Hz and 20 kHz, without preamp. */
export function peakDb(bands: readonly EqBand[]): number {
  if (bands.every((b) => isBypassed(b, REFERENCE_SAMPLE_RATE))) return 0;
  let peak = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= RESPONSE_POINTS; i++) {
    peak = Math.max(peak, magnitudeDb(bands, frequencyAt(i / RESPONSE_POINTS)));
  }
  return peak;
}

/** The preamp that keeps the loudest point of the curve at 0 dB, and never a boost. */
export function autoPreampDb(bands: readonly EqBand[]): number {
  const peak = peakDb(bands);
  return peak > 0 ? -peak : 0;
}
