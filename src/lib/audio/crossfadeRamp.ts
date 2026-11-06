const CURVE_POINTS = 32;
const STEP_MS = 100;

export type CrossfadeCurve = "equal_power" | "s_curve" | "hold" | "gentle";

/** The gentle curve's shape: its two gains add up to one, so the middle of the fade dips a little. */
const GENTLE_POWER = 1.6;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Equal-power curves differ only in how time passes through them, so all keep the blend's loudness. */
function eased(t: number, shape: CrossfadeCurve): number {
  if (shape === "s_curve") return t * t * (3 - 2 * t);
  if (shape === "hold") return t * t;
  return t;
}

export function fadeInGain(t: number, shape: CrossfadeCurve = "equal_power"): number {
  const p = clamp01(t);
  return shape === "gentle" ? 1 - (1 - p) ** GENTLE_POWER : Math.sin((eased(p, shape) * Math.PI) / 2);
}

export function fadeOutGain(t: number, shape: CrossfadeCurve = "equal_power"): number {
  const p = clamp01(t);
  return shape === "gentle" ? (1 - p) ** GENTLE_POWER : Math.cos((eased(p, shape) * Math.PI) / 2);
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
  shape: CrossfadeCurve = "equal_power",
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
