import type { Rgb } from "../../useDominantColor";
import {
  FEATHER_EM,
  GLOW_RADIUS_PX,
  GLOW_STEPS,
  WORD_LIFT_PX,
  drawKaraoke,
  type KaraokeFrame,
  type KaraokeGeometry,
  type KaraokePaint,
} from "./karaoke";
import { LOW_BOUNCY_LOW, Spring } from "./motion";
import { cssBlurOf } from "./rowMotion";

const rgba = (c: Rgb, a: number): string => `rgba(${c.r},${c.g},${c.b},${a})`;

/** How far the canvas reaches past the text: room for lifted words, the glow and italic overhang. */
export const karaokePadding = (textSize: number): { x: number; y: number } => ({
  x: Math.ceil(textSize * 0.25 + GLOW_RADIUS_PX),
  y: Math.ceil(WORD_LIFT_PX + GLOW_RADIUS_PX + textSize * 0.1),
});

export interface KaraokeSurfaceOptions {
  geometry: KaraokeGeometry;
  width: number;
  height: number;
  textSize: number;
  accent: Rgb;
  /** The unsung part's alpha while the line is sung: 0.45, or 0.6 for a background vocal. */
  unsungAlpha: number;
  glow: boolean;
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
  private lastSungPosition: number | null = null;
  private current = false;
  private dirty = true;
  // Reused every frame, so drawing allocates nothing.
  private readonly frame: KaraokeFrame;
  readonly padX: number;
  readonly padY: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: KaraokeSurfaceOptions,
  ) {
    this.ctx = canvas.getContext("2d");
    const pad = karaokePadding(options.textSize);
    this.padX = pad.x;
    this.padY = pad.y;
    this.frame = {
      position: null,
      liftClock: null,
      lift: 0,
      glow: options.glow && options.motion,
      overscan: this.padY,
      height: options.height,
    };
    this.resize();
    const feather = options.textSize * FEATHER_EM;
    const sung = rgba(options.accent, 1);
    const unsung = rgba(options.accent, options.unsungAlpha);
    const glowColors: string[] = [];
    const glowBlurs: number[] = [];
    for (let step = 0; step < GLOW_STEPS; step++) {
      const strength = (step + 1) / GLOW_STEPS;
      glowColors.push(rgba(options.accent, 0.5 * strength));
      // Canvas shadowBlur is twice the Gaussian sigma.
      glowBlurs.push(2 * cssBlurOf(GLOW_RADIUS_PX * strength));
    }
    const front = (from: string, to: string): CanvasGradient | string => {
      if (!this.ctx) return from;
      const gradient = this.ctx.createLinearGradient(-feather / 2, 0, feather / 2, 0);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);
      return gradient;
    };
    this.sungPaint = { sung, unsung, forward: front(sung, unsung), backward: front(unsung, sung), glowColors, glowBlurs };
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
    this.current = current;
    this.lineLift.animateTo(current && this.options.motion ? 1 : 0);
    this.dirty = true;
  }

  /**
   * Draws when something changed; `position` is the offset-adjusted song time while the line is
   * sung and playing. True while the line needs another frame.
   */
  step(dtMs: number, position: number | null, playing: boolean): boolean {
    const lifting = this.lineLift.step(dtMs);
    const singing = this.current && position !== null;
    if (!singing && !lifting && !this.dirty) return false;
    this.dirty = false;
    if (singing) this.lastSungPosition = position;
    this.draw(singing ? position : null);
    return lifting || (singing && playing);
  }

  private draw(position: number | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(-this.padX, -this.padY, this.options.width + this.padX * 2, this.options.height + this.padY * 2);
    this.frame.position = position;
    // Words keep their lift while an ended line settles back, but their fill turns unsung.
    this.frame.liftClock = position ?? this.lastSungPosition;
    this.frame.lift = this.lineLift.value;
    drawKaraoke(ctx, this.options.geometry, position !== null ? this.sungPaint : this.idlePaint, this.frame);
  }
}
