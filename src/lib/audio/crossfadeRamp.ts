const CURVE_POINTS = 32;
const STEP_MS = 100;

/** Equal-power gains for `t` in 0..1: the sum of both sides' power stays constant. */
export const fadeInGain = (t: number): number => Math.sin((Math.max(0, Math.min(1, t)) * Math.PI) / 2);
export const fadeOutGain = (t: number): number => Math.cos((Math.max(0, Math.min(1, t)) * Math.PI) / 2);

function curve(gain: (t: number) => number): Float32Array<ArrayBuffer> {
  const values = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) values[i] = gain(i / (CURVE_POINTS - 1));
  return values;
}

/**
 * Schedules a whole fade on the audio clock, so it runs smoothly even while the window is hidden
 * and timers are throttled.
 */
export function scheduleFade(param: AudioParam, direction: "in" | "out", startTime: number, seconds: number): void {
  param.cancelScheduledValues(startTime);
  param.setValueCurveAtTime(curve(direction === "in" ? fadeInGain : fadeOutGain), startTime, seconds);
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
