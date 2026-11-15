import type { Rgb } from "../../useDominantColor";
import { glowLook, type LyricsAnimation, type LyricsGlow } from "../useLyricsLook";
import { CADENCE_EXIT_MS, CADENCE_PEAK_EM, drawCadence, reflowAnchor, type CadenceFrame } from "./cadence";
import { FEATHER_EM, GLOW_LEVELS, WORD_LIFT_PX, drawKaraoke, type KaraokeFrame, type KaraokeGeometry, type KaraokePaint } from "./karaoke";
import { LOW_BOUNCY_LOW, Spring } from "./motion";
import type { LyricsAlign } from "./presentation";
import { cssBlurOf } from "./rowMotion";

const rgba = (c: Rgb, a: number): string => `rgba(${c.r},${c.g},${c.b},${a})`;

/**
 * How far the canvas reaches past the text: room for lifted words, the glow, italic overhang and,
 * on a Cadence line, letters at their crest and words grown wider than their row.
 */
export const karaokePadding = (textSize: number, glow: LyricsGlow): { x: number; y: number } => {
  const glowRadius = glowLook(glow).radius;
  return { x: Math.ceil(textSize * 0.5 + glowRadius), y: Math.ceil(WORD_LIFT_PX + glowRadius + textSize * 0.4) };
};

export interface KaraokeSurfaceOptions {
  geometry: KaraokeGeometry;
  width: number;
  height: number;
  textSize: number;
  accent: Rgb;
  /** The unsung part's alpha while the line is sung: 0.45, or 0.6 for a background vocal. */
  unsungAlpha: number;
  align: LyricsAlign;
  animation: LyricsAnimation;
  glow: LyricsGlow;
  /** False when the system asks for reduced motion: every style then fills only, as Calm does. */
  motion: boolean;
}

/**
 * One karaoke line's canvas: its paints are made once, and only the line being sung redraws, once
 * per frame, from the laid-out geometry. The canvas reaches past the text by the lift and the glow.
 */
export class KaraokeSurface {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly lineLift = new Spring(0, LOW_BOUNCY_LOW);
  private readonly sungPaint: KaraokePaint;
  private readonly idlePaint: KaraokePaint;
  private readonly moving: boolean;
  private readonly cadence: boolean;
  private lastSungPosition: number | null = null;
  private current = false;
  /** How long a Cadence line has been letting go, in ms, or -1 when it isn't. */
  private exitMs = -1;
  private dirty = true;
  // Reused every frame, so drawing allocates nothing.
  private readonly frame: KaraokeFrame;
  private readonly cadenceFrame: CadenceFrame;
  readonly padX: number;
  readonly padY: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: KaraokeSurfaceOptions,
  ) {
    this.ctx = canvas.getContext("2d");
    const pad = karaokePadding(options.textSize, options.glow);
    this.padX = pad.x;
    this.padY = pad.y;
    this.moving = options.motion && options.animation !== "calm";
    this.cadence = options.motion && options.animation === "cadence";
    const glow = this.moving && options.glow !== "off";
    const feather = options.textSize * FEATHER_EM;
    this.frame = {
      position: null,
      liftClock: null,
      lift: 0,
      glow,
      overscan: this.padY,
      height: options.height,
    };
    this.cadenceFrame = {
      position: null,
      exit: -1,
      lineLift: 0,
      peakPx: options.textSize * CADENCE_PEAK_EM,
      featherPx: feather,
      anchor: reflowAnchor(options.align),
      glow,
      overscan: this.padY,
      height: options.height,
    };
    this.resize();
    const sung = rgba(options.accent, 1);
    const unsung = rgba(options.accent, options.unsungAlpha);
    const look = glowLook(options.glow);
    const glowColors = Array.from({ length: GLOW_LEVELS }, (_, level) => rgba(options.accent, (look.alpha * (level + 1)) / GLOW_LEVELS));
    // Canvas shadowBlur is twice the Gaussian sigma.
    const glowBlur = 2 * cssBlurOf(look.radius);
    const front = (from: string, to: string): CanvasGradient | string => {
      if (!this.ctx) return from;
      const gradient = this.ctx.createLinearGradient(-feather / 2, 0, feather / 2, 0);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      return gradient;
    };
    this.sungPaint = { sung, unsung, forward: front(sung, unsung), backward: front(unsung, sung), glowColors, glowBlur };
    this.idlePaint = { ...this.sungPaint, unsung: sung };
  }

  /** Sizes the backing store for the current pixel ratio; the context state resets with it. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.options.width + this.padX * 2;
    const cssHeight = this.options.height + this.padY * 2;
    this.canvas.width = Math.ceil(cssWidth * dpr);
    this.canvas.height = Math.ceil(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, this.padX * dpr, this.padY * dpr);
      this.ctx.font = this.options.geometry.font;
      this.ctx.textAlign = "left";
      this.ctx.textBaseline = "alphabetic";
    }
    this.dirty = true;
  }

  /** Something the canvas shows changed while nothing was moving, such as a seek while paused. */
  invalidate(): void {
    this.dirty = true;
  }

  setCurrent(current: boolean): void {
    if (current === this.current) return;
    // A Cadence line that was being sung lets go: its fill completes and grown words settle.
    this.exitMs = !current && this.cadence && this.lastSungPosition !== null ? 0 : -1;
    this.current = current;
    this.lineLift.animateTo(current && this.moving ? 1 : 0);
    this.dirty = true;
  }

  /**
   * Draws when something changed; `position` is the offset-adjusted song time while the line is
   * sung and playing. True while the line needs another frame.
   */
  step(dtMs: number, position: number | null, playing: boolean): boolean {
    const lifting = this.lineLift.step(dtMs);
    const exiting = this.exitMs >= 0;
    if (exiting) {
      this.exitMs += dtMs;
      if (this.exitMs >= CADENCE_EXIT_MS) this.exitMs = -1;
    }
    const singing = this.current && position !== null;
    if (!singing && !lifting && !exiting && !this.dirty) return false;
    this.dirty = false;
    if (singing) this.lastSungPosition = position;
    this.draw(singing ? position : null);
    return lifting || exiting || (singing && playing);
  }

  private draw(position: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(-this.padX, -this.padY, this.options.width + this.padX * 2, this.options.height + this.padY * 2);
    const lift = this.lineLift.value;
    if (this.cadence && (position !== null || lift !== 0 || this.exitMs >= 0)) {
      const frame = this.cadenceFrame;
      frame.position = position ?? this.lastSungPosition;
      frame.exit = position !== null ? -1 : this.exitMs >= 0 ? this.exitMs / CADENCE_EXIT_MS : 1;
      frame.lineLift = lift;
      drawCadence(ctx, this.options.geometry, this.sungPaint, frame);
      return;
    }
    this.frame.position = position;
    // Words keep their lift while an ended line settles back, but their fill turns unsung.
    this.frame.liftClock = position ?? this.lastSungPosition;
    this.frame.lift = this.lineLift.value;
    drawKaraoke(ctx, this.options.geometry, position !== null ? this.sungPaint : this.idlePaint, this.frame);
  }
}
