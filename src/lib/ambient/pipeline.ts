/*
  Port of Android's AmbientFramePipeline.kt. The sizes, tau, thresholds and gain are the same on
  purpose; change them there first. The light look is desktop only: Android's ambient mode always
  sits on a black scrim, so it has no light theme to paint on.
*/
export const SAMPLE_W = 96;
export const SAMPLE_H = 54;
export const DISPLAY_W = 32;
export const DISPLAY_H = 18;
const DECIMATION = 3;

const CELLS = DISPLAY_W * DISPLAY_H;
const CHANNELS = 3;

export const SMOOTH_TICK_MS = 60;
export const SMOOTH_IDLE_TICK_MS = 200;
/*
  Also bounds how fast the glow can follow strobing content: a first-order filter at 600 ms
  attenuates 3 Hz flashes by about 21 dB, which keeps them under WCAG 2.3.1's limit. Never add a
  "snap on large delta" path to make cuts crisper. If cuts feel soft, lower tau instead.
*/
const SMOOTH_TAU_MS = 600;
const CONVERGENCE_EPS = 0.0015;
const BLUR_RADIUS = 2;
const BLUR_PASSES = 3;
const AMBIENT_GAIN = 0.28;
export const FRAME_CHANGE_THRESHOLD = 4;
const CHANGE_SAMPLE_STEP = 7;
const LINEAR_LUT_SIZE = 4096;

/** The slider value at which the dark look equals Android's fixed gain. */
export const AMBIENT_INTENSITY_DEFAULT = 60;

// A light page can't take the dark look: dimmed colors over white read as a dirty shadow. So the
// colors stay at full brightness and strength goes into alpha, which lets dull areas fade out.
const LIGHT_SATURATION_BOOST = 1.45;
const LIGHT_BASE_ALPHA = 0.62;
const LIGHT_SATURATION_FLOOR = 0.04;
const LIGHT_SATURATION_FULL = 0.32;
const LIGHT_BRIGHTNESS_FLOOR = 0.004;
const LIGHT_BRIGHTNESS_FULL = 0.05;

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const LINEAR_TO_SRGB = Uint8Array.from({ length: LINEAR_LUT_SIZE + 1 }, (_, i) => {
  const c = i / LINEAR_LUT_SIZE;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.floor(s * 255 + 0.5)));
});

export function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return LINEAR_TO_SRGB[Math.floor(clamped * LINEAR_LUT_SIZE + 0.5)]!;
}

export function srgbToLinear(byte: number): number {
  return SRGB_TO_LINEAR[Math.min(255, Math.max(0, byte))]!;
}

/** Mean absolute per-channel difference over every 7th RGBA pixel. */
export function meanAbsDiff(current: Uint8ClampedArray, previous: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < current.length; i += CHANGE_SAMPLE_STEP * 4) {
    sum += Math.abs(current[i]! - previous[i]!);
    sum += Math.abs(current[i + 1]! - previous[i + 1]!);
    sum += Math.abs(current[i + 2]! - previous[i + 2]!);
    count += 3;
  }
  return count === 0 ? 0 : Math.floor(sum / count);
}

/*
  An exact 3x3 box, averaged in linear light. A bilinear resize samples too few texels and brings
  back a crawling glow on fine detail; averaging in sRGB makes saturated complementaries land
  darker than either input.
*/
export function decimateToLinear(src: Uint8ClampedArray, dst: Float32Array) {
  const n = DECIMATION * DECIMATION;
  let o = 0;
  for (let y = 0; y < DISPLAY_H; y += 1) {
    for (let x = 0; x < DISPLAY_W; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < DECIMATION; dy += 1) {
        let idx = ((y * DECIMATION + dy) * SAMPLE_W + x * DECIMATION) * 4;
        for (let dx = 0; dx < DECIMATION; dx += 1) {
          r += SRGB_TO_LINEAR[src[idx]!]!;
          g += SRGB_TO_LINEAR[src[idx + 1]!]!;
          b += SRGB_TO_LINEAR[src[idx + 2]!]!;
          idx += 4;
        }
      }
      dst[o++] = r / n;
      dst[o++] = g / n;
      dst[o++] = b / n;
    }
  }
}

function blurAxis(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number, horizontal: boolean) {
  const lines = horizontal ? h : w;
  const span = horizontal ? w : h;
  const n = radius * 2 + 1;
  for (let line = 0; line < lines; line += 1) {
    for (let i = 0; i < span; i += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const j = Math.min(span - 1, Math.max(0, i + k));
        const o = (horizontal ? line * w + j : j * w + line) * CHANNELS;
        r += src[o]!;
        g += src[o + 1]!;
        b += src[o + 2]!;
      }
      const o = (horizontal ? line * w + i : i * w + line) * CHANNELS;
      dst[o] = r / n;
      dst[o + 1] = g / n;
      dst[o + 2] = b / n;
    }
  }
}

export function boxBlurLinear(buf: Float32Array, scratch: Float32Array, w: number, h: number, radius: number, passes: number) {
  for (let pass = 0; pass < passes; pass += 1) {
    blurAxis(buf, scratch, w, h, radius, true);
    blurAxis(scratch, buf, w, h, radius, false);
  }
}

/** Measured time, not a per-tick constant, so the filter behaves the same at any tick rate. */
export function smoothingAlpha(dtMs: number): number {
  return 1 - Math.exp(-dtMs / SMOOTH_TAU_MS);
}

/** Walks current toward target; returns whether anything moved beyond the epsilon. */
export function step(current: Float32Array, target: Float32Array, alpha: number): boolean {
  let moved = false;
  for (let i = 0; i < current.length; i += 1) {
    const delta = target[i]! - current[i]!;
    if (Math.abs(delta) > CONVERGENCE_EPS) {
      current[i]! += delta * alpha;
      moved = true;
    } else {
      current[i] = target[i]!;
    }
  }
  return moved;
}

export type AmbientLook = { variant: "dark" | "light"; intensity: number };

export function encodeDark(grid: Float32Array, out: Uint8ClampedArray, intensity: number) {
  const gain = AMBIENT_GAIN * (intensity / AMBIENT_INTENSITY_DEFAULT);
  for (let i = 0; i < CELLS; i += 1) {
    const o = i * CHANNELS;
    const p = i * 4;
    out[p] = linearToSrgb(grid[o]! * gain);
    out[p + 1] = linearToSrgb(grid[o + 1]! * gain);
    out[p + 2] = linearToSrgb(grid[o + 2]! * gain);
    out[p + 3] = 255;
  }
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function encodeLight(grid: Float32Array, out: Uint8ClampedArray, intensity: number) {
  const strength = Math.min(1, LIGHT_BASE_ALPHA * (intensity / AMBIENT_INTENSITY_DEFAULT));
  for (let i = 0; i < CELLS; i += 1) {
    const o = i * CHANNELS;
    const p = i * 4;
    const r = grid[o]!;
    const g = grid[o + 1]!;
    const b = grid[o + 2]!;
    const max = Math.max(r, g, b);
    if (max <= 0) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }
    const vivid = (c: number) => linearToSrgb(Math.max(0, 1 - (1 - c / max) * LIGHT_SATURATION_BOOST));
    const saturation = (max - Math.min(r, g, b)) / max;
    out[p] = vivid(r);
    out[p + 1] = vivid(g);
    out[p + 2] = vivid(b);
    out[p + 3] = Math.round(
      255 *
        strength *
        smoothstep(LIGHT_SATURATION_FLOOR, LIGHT_SATURATION_FULL, saturation) *
        smoothstep(LIGHT_BRIGHTNESS_FLOOR, LIGHT_BRIGHTNESS_FULL, max),
    );
  }
}

/** Owns the buffers for one run of the glow; nothing allocates after construction. */
export class AmbientPipeline {
  private readonly previous = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
  private readonly target = new Float32Array(CELLS * CHANNELS);
  private readonly current = new Float32Array(CELLS * CHANNELS);
  private readonly staging = new Float32Array(CELLS * CHANNELS);
  private readonly scratch = new Float32Array(CELLS * CHANNELS);
  private hasPrevious = false;
  private hasTarget = false;
  private seeded = false;

  /** Takes a captured RGBA frame; returns true when it differed enough to become the new target. */
  offerFrame(pixels: Uint8ClampedArray): boolean {
    if (this.hasPrevious && meanAbsDiff(pixels, this.previous) < FRAME_CHANGE_THRESHOLD) return false;
    // Advances only on an accepted frame, so a slow fade adds up against a fixed reference.
    this.previous.set(pixels);
    this.hasPrevious = true;
    decimateToLinear(pixels, this.staging);
    boxBlurLinear(this.staging, this.scratch, DISPLAY_W, DISPLAY_H, BLUR_RADIUS, BLUR_PASSES);
    this.target.set(this.staging);
    this.hasTarget = true;
    return true;
  }

  /** Moves the glow by dt; returns true when there is something new to draw. */
  advance(dtMs: number): boolean {
    if (!this.hasTarget) return false;
    if (!this.seeded) {
      this.current.set(this.target);
      this.seeded = true;
      return true;
    }
    return step(this.current, this.target, smoothingAlpha(dtMs));
  }

  get hasFrame(): boolean {
    return this.seeded;
  }

  encode(out: Uint8ClampedArray, look: AmbientLook) {
    if (look.variant === "light") encodeLight(this.current, out, look.intensity);
    else encodeDark(this.current, out, look.intensity);
  }
}
