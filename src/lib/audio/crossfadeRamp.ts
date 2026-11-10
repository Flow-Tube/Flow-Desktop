const CURVE_POINTS = 32;
const STEP_MS = 100;

/** Flow for Android's curves, under its names. */
export type CrossfadeCurve = "EQUAL_POWER" | "S_CURVE" | "HOLD" | "GENTLE";

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smoothstep = (p: number) => p * p * (3 - 2 * p);

/**
 * The outgoing song's gain `t` of the way through the fade. Equal power and Smooth are pairs;
 * Hold and Gentle shape only the outgoing song, which leaves later or sooner over a steady
 * incoming one.
 */
export function fadeOutGain(t: number, shape: CrossfadeCurve = "EQUAL_POWER"): number {
  const p = clamp01(t);
  switch (shape) {
    case "S_CURVE":
      return 1 - smoothstep(p);
    case "HOLD":
      return 1 - p * p * p;
    case "GENTLE":
      return (1 - p) * (1 - p);
    default:
      return Math.cos((p * Math.PI) / 2);
  }
}

/** The incoming song's gain `t` of the way through the fade. */
export function fadeInGain(t: number, shape: CrossfadeCurve = "EQUAL_POWER"): number {
  const p = clamp01(t);
  return shape === "S_CURVE" ? smoothstep(p) : Math.sin((p * Math.PI) / 2);
}

function curve(gain: (t: number) => number): Float32Array<ArrayBuffer> {
  const values = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) values[i] = gain(i / (CURVE_POINTS - 1));
  return values;
}

/**
 * Schedules a whole fade on the audio clock, so it runs smoothly even while the window is hidden
 * and timers are throttled.
 */
export function scheduleFade(
  param: AudioParam,
  direction: "in" | "out",
  startTime: number,
  seconds: number,
  shape: CrossfadeCurve = "EQUAL_POWER",
): void {
  param.cancelScheduledValues(startTime);
  const gain = direction === "in" ? fadeInGain : fadeOutGain;
  param.setValueCurveAtTime(curve((t) => gain(t, shape)), startTime, seconds);
}

/** Puts `param` back at full level at once, dropping any fade still scheduled on it. */
export function resetFade(param: AudioParam, time: number): void {
  param.cancelScheduledValues(time);
  param.setValueAtTime(1, time);
}

/**
 * The fallback without WebAudio: element volume moved in steps. Returns a cancel function.
 * `onStep` gets the fade's progress from 0 to 1.
 */
export function steppedFade(seconds: number, onStep: (progress: number) => void): () => void {
  const started = Date.now();
  onStep(0);
  const timer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - started) / (seconds * 1_000));
    onStep(progress);
    if (progress >= 1) clearInterval(timer);
  }, STEP_MS);
  return () => clearInterval(timer);
}
