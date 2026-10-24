import { frequencyAt, magnitudeDb } from "./filterMath";
import { band, EqLimits, hasGain, type EqBand, type EqCurve } from "./models";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Rounds to a multiple of `step` with ties to even, like Kotlin's `round`, and never leaves a negative zero. */
export function roundTo(value: number, step: number): number {
  const x = value / step;
  const floor = Math.floor(x);
  const diff = x - floor;
  const whole = diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
  return whole * step + 0;
}

/** Null when the band cannot be made valid (not a number, or a zero or negative frequency or Q). */
export function sanitizeBand(b: EqBand): EqBand | null {
  if (!Number.isFinite(b.frequency) || !Number.isFinite(b.gain) || !Number.isFinite(b.q)) return null;
  if (b.frequency <= 0 || b.q <= 0) return null;
  return {
    ...b,
    frequency: clamp(b.frequency, EqLimits.MIN_FREQUENCY, EqLimits.MAX_FREQUENCY),
    gain: hasGain(b.type) ? clamp(b.gain, EqLimits.MIN_GAIN, EqLimits.MAX_GAIN) : 0,
    q: clamp(b.q, EqLimits.MIN_Q, EqLimits.MAX_Q),
  };
}

export function sanitizeCurve(curve: EqCurve): EqCurve {
  return {
    preamp: Number.isFinite(curve.preamp) ? clamp(curve.preamp, EqLimits.MIN_PREAMP, EqLimits.MAX_PREAMP) : 0,
    bands: curve.bands
      .map(sanitizeBand)
      .filter((b): b is EqBand => b !== null)
      .slice(0, EqLimits.MAX_BANDS),
  };
}

const FIT_POINTS = 96;
const FIT_PASSES = 4;
const FIT_SMOOTHING = 6;

/** Ten octave bands, 31 Hz to 16 kHz, all peaking, as on Flow for Android. */
export const GraphicEq = {
  FREQUENCIES: [31, 63, 125, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000] as const,
  Q: 1.41,
  MAX_GAIN: 12,
  STEP: 0.5,

  flatCurve(): EqCurve {
    return GraphicEq.curveOf(GraphicEq.FREQUENCIES.map(() => 0));
  },

  curveOf(gains: readonly number[], preamp = 0): EqCurve {
    return {
      preamp,
      bands: GraphicEq.FREQUENCIES.map((frequency, i) => band(frequency, gains[i] ?? 0, GraphicEq.Q)),
    };
  },

  /**
   * The ten gains whose response comes closest to `curve` across the whole range: a least-squares
   * fit on a log grid, with a penalty on the step between neighbouring bands so the sliders do not
   * zigzag, then refined against the real, overlapping filters.
   */
  fit(curve: EqCurve): EqCurve {
    const grid = Array.from({ length: FIT_POINTS }, (_, k) => frequencyAt(k / (FIT_POINTS - 1)));
    const target = grid.map((f) => magnitudeDb(curve.bands, f));
    const basis = GraphicEq.FREQUENCIES.map((centre) => {
      const unit = [band(centre, 1, GraphicEq.Q)];
      return grid.map((f) => magnitudeDb(unit, f));
    });
    let gains: number[] = GraphicEq.FREQUENCIES.map(() => 0);
    for (let pass = 0; pass < FIT_PASSES; pass++) {
      const bands = GraphicEq.curveOf(gains).bands;
      const residual = grid.map((f, k) => (target[k] ?? 0) - magnitudeDb(bands, f));
      const step = solveDamped(basis, residual);
      gains = gains.map((gain, i) => clamp(gain + (step[i] ?? 0), -GraphicEq.MAX_GAIN, GraphicEq.MAX_GAIN));
    }
    return GraphicEq.curveOf(
      gains.map((g) => roundTo(g, GraphicEq.STEP)),
      curve.preamp,
    );
  },

  /** Reads a stored graphic curve back as ten gains; anything malformed becomes flat. */
  gainsOf(curve: EqCurve): number[] {
    if (curve.bands.length !== GraphicEq.FREQUENCIES.length) return GraphicEq.FREQUENCIES.map(() => 0);
    return curve.bands.map((b) => clamp(b.gain, -GraphicEq.MAX_GAIN, GraphicEq.MAX_GAIN));
  },
};

const dot = (x: readonly number[], y: readonly number[]) => x.reduce((sum, v, k) => sum + v * (y[k] ?? 0), 0);

/** Solves (B·Bᵀ + λ·DᵀD)·x = B·r, D being the difference between neighbouring bands, by Gaussian elimination. */
function solveDamped(basis: readonly number[][], residual: readonly number[]): number[] {
  const n = basis.length;
  const width = n + 1;
  // Row-major augmented matrix; rows are swapped by index rather than moved.
  const a = new Float64Array(n * width);
  const rows = Array.from({ length: n }, (_, i) => i);
  const get = (r: number, c: number) => a[(rows[r] ?? 0) * width + c] ?? 0;
  const add = (r: number, c: number, v: number) => {
    a[(rows[r] ?? 0) * width + c] = get(r, c) + v;
  };
  basis.forEach((bi, i) => {
    basis.forEach((bj, j) => add(i, j, dot(bi, bj)));
    add(i, i, FIT_SMOOTHING * (i === 0 || i === n - 1 ? 1 : 2));
    if (i > 0) add(i, i - 1, -FIT_SMOOTHING);
    if (i < n - 1) add(i, i + 1, -FIT_SMOOTHING);
    add(i, n, dot(bi, residual));
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(get(row, col)) > Math.abs(get(pivot, col))) pivot = row;
    }
    [rows[col], rows[pivot]] = [rows[pivot] ?? 0, rows[col] ?? 0];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = get(row, col) / get(col, col);
      for (let c = col; c <= n; c++) add(row, c, -factor * get(col, c));
    }
  }
  return rows.map((_, i) => get(i, n) / get(i, i));
}
