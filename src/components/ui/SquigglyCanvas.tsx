import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Android's "Squiggly" seek bar, drawn on a canvas: the played part is a wave and the rest a
 * straight line, both with round caps, with a round thumb that grows while pressed and a stop dot
 * at the end. The wave moves one wavelength a second while music plays and eases flat when it
 * stops; once paused and flat nothing moves, so the frame loop stops too (Android's `WaveMotion`).
 */

export interface SquigglyLook {
  stroke: number;
  amplitude: number;
  wavelength: number;
  thumb: number;
  thumbPressed: number;
  /** Space between the thumb and the track on either side. */
  thumbGap: number;
  stopDot: number;
}

/** Android's numbers for the full player's seek bar, in CSS pixels. */
export const SQUIGGLY_SEEK: SquigglyLook = { stroke: 5, amplitude: 3, wavelength: 32, thumb: 14, thumbPressed: 20, thumbGap: 4, stopDot: 4 };

/** The same wave, scaled to sit along the bottom of the mini player. */
export const SQUIGGLY_MINI: SquigglyLook = { stroke: 3, amplitude: 2, wavelength: 24, thumb: 0, thumbPressed: 10, thumbGap: 3, stopDot: 3 };

const INACTIVE_ALPHA = 0.24;
/** Points along the wave per pixel of track. */
const WAVE_STEP_PX = 2;

/** A critically damped spring towards `target`, Material's slow effects (stiffness 800). */
function springStep(value: number, velocity: number, target: number, dtS: number, stiffness: number): [number, number] {
  const damping = 2 * Math.sqrt(stiffness);
  const accel = -stiffness * (value - target) - damping * velocity;
  const v = velocity + accel * dtS;
  const next = value + v * dtS;
  return Math.abs(next - target) < 0.001 && Math.abs(v) < 0.01 ? [target, 0] : [next, v];
}

interface SquigglyCanvasProps {
  /** Played share, 0 to 1, used when `readRatio` is not given or while dragging. */
  ratio: number;
  /** The live share each frame while the media plays, for a bar that follows the clock. */
  readRatio?: () => number;
  playing: boolean;
  /** Grows the thumb. */
  pressed: boolean;
  /** Holds the wave still under the pointer, as Android does while dragging; defaults to `pressed`. */
  still?: boolean;
  look: SquigglyLook;
  className?: string;
}

export function SquigglyCanvas({ ratio, readRatio, playing, pressed, still = pressed, look, className = "" }: SquigglyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ ratio, readRatio, playing, pressed, still, look });
  live.current = { ratio, readRatio, playing, pressed, still, look };
  const state = useRef({ phase: 0, amplitude: playing ? 1 : 0, ampV: 0, thumb: look.thumb, thumbV: 0, color: "", colorAt: 0 });
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const size = useRef({ width: 0, height: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { look: l, readRatio: read, ratio: fixed } = live.current;
    const s = state.current;
    const now = performance.now();
    if (!s.color || now - s.colorAt > 500) {
      s.color = getComputedStyle(canvas).color;
      s.colorAt = now;
    }
    const { width, height } = size.current;
    ctx.clearRect(0, 0, width, height);
    const share = Math.min(1, Math.max(0, !read ? fixed : read()));
    const mid = height / 2;
    const edge = l.stroke / 2;
    const end = width - edge;
    const at = edge + (end - edge) * share;
    const gap = l.thumbPressed > 0 ? l.thumbPressed / 2 + l.thumbGap : 0;
    const waveEnd = at - (s.thumb > 0 ? gap : 0);
    const restStart = at + (s.thumb > 0 ? gap : 0);
    ctx.lineCap = "round";
    ctx.lineWidth = l.stroke;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    if (restStart < end) {
      ctx.globalAlpha = INACTIVE_ALPHA;
      ctx.beginPath();
      ctx.moveTo(restStart, mid);
      ctx.lineTo(end, mid);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (l.stopDot > 0) {
      ctx.beginPath();
      ctx.arc(end, mid, l.stopDot / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (waveEnd > edge) {
      const height2 = l.amplitude * s.amplitude;
      const shift = s.phase * 2 * Math.PI;
      const k = (2 * Math.PI) / l.wavelength;
      ctx.beginPath();
      let x = edge;
      ctx.moveTo(x, mid + height2 * Math.sin(x * k - shift));
      while (x < waveEnd) {
        x = Math.min(x + WAVE_STEP_PX, waveEnd);
        ctx.lineTo(x, mid + height2 * Math.sin(x * k - shift));
      }
      ctx.stroke();
    }
    if (s.thumb > 0.5) {
      ctx.beginPath();
      ctx.arc(at, mid, s.thumb / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const frame = (now: number) => {
    const dtS = Math.min(0.05, (now - last.current) / 1000);
    last.current = now;
    const { playing: on, pressed: held, still: hold, look: l, readRatio: read } = live.current;
    const s = state.current;
    const moving = on && !hold;
    if (moving) s.phase = (s.phase + dtS) % 1;
    [s.amplitude, s.ampV] = springStep(s.amplitude, s.ampV, on ? 1 : 0, dtS, 800);
    [s.thumb, s.thumbV] = springStep(s.thumb, s.thumbV, held ? l.thumbPressed : l.thumb, dtS, 1400);
    draw();
    const settling = s.ampV !== 0 || s.thumbV !== 0;
    raf.current = moving || settling || (on && read) ? requestAnimationFrame(frame) : null;
  };

  const wake = () => {
    if (raf.current !== null) return;
    last.current = performance.now();
    raf.current = requestAnimationFrame(frame);
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    resize();
    return () => observer?.disconnect();
  }, []);

  // Any change of what is shown wakes the loop; it stops itself once nothing moves.
  useEffect(() => {
    wake();
  }, [ratio, readRatio, playing, pressed, still, look]);

  useEffect(
    () => () => {
      // Cleared as well as cancelled: StrictMode mounts twice, and a stale handle would keep
      // `wake` from ever starting the loop again, leaving the wave frozen.
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  return <canvas ref={canvasRef} aria-hidden className={`block text-[var(--color-primary)] ${className}`} />;
}
