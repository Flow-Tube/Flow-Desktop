/** About -0.45 dBFS: below it samples pass untouched; above it they bend towards full scale instead of clipping. */
const KNEE = 0.95;

/** Android's soft knee (`EqualizerAudioProcessor.softClip`). */
export function softClip(sample: number): number {
  const magnitude = Math.abs(sample);
  if (magnitude <= KNEE) return sample;
  const shaped = KNEE + (1 - KNEE) * Math.tanh((magnitude - KNEE) / (1 - KNEE));
  return sample < 0 ? -shaped : shaped;
}

/**
 * How far past full scale the shaper still bends rather than flattens. A WaveShaperNode clamps its
 * input to ±1, so the signal is scaled by 1/SOFT_CLIP_HEADROOM on the way in and the curve spans
 * ±SOFT_CLIP_HEADROOM.
 */
export const SOFT_CLIP_HEADROOM = 4;

// Odd, so the middle point is exactly zero and silence stays silent.
const CURVE_POINTS = 8_193;

/** The WaveShaperNode curve for a signal already scaled by 1/SOFT_CLIP_HEADROOM. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = SOFT_CLIP_HEADROOM * ((2 * i) / (CURVE_POINTS - 1) - 1);
    curve[i] = softClip(x);
  }
  return curve;
}
