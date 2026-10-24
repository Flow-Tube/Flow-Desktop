import { DEFAULT_EFFECTS, DEFAULT_SPATIAL, SLOW_EFFECTS, SLOW_SPATIAL, Spring, Tween } from "./motion";
import { INDICATOR_HEIGHT } from "./rowLayout";

/** Where a row should be and how it should look, decided by the panel on each line change. */
export interface RowTarget {
  offset: number;
  /** Rows spring to a new offset one after another, nearest first, so a line change cascades. */
  staggerMs: number;
  scale: number;
  alpha: number;
  /** Android's blur radius in px; 0 for none. */
  blurRadius: number;
  /** Lines being sung draw at full strength; their colours carry the fill. */
  active: boolean;
  /** For a background vocal line or an instrumental break: whether it is shown at all. */
  presence: boolean;
}

export interface RowMotionOptions {
  /** A manual scroll freezes the rows where they are. */
  autoScroll: boolean;
  /** The first layout, or reduced motion: rows go straight to their targets. */
  snap: boolean;
  /** Blur is off where the engine draws it on the CPU. */
  blur: boolean;
}

const STAGGER_PER_ROW_MS = 20;
const STAGGER_MAX_MS = 200;
const BACKGROUND_ALPHA = 0.6;
const BACKGROUND_FADE_MS = 250;
const BACKGROUND_FADE_DELAY_MS = 100;
const INDICATOR_FADE_MS = 240;

export const staggerFor = (distance: number): number => Math.min(distance * STAGGER_PER_ROW_MS, STAGGER_MAX_MS);

/** Skia turns a blur radius into a Gaussian sigma this way; CSS blur() takes the sigma. */
export const cssBlurOf = (radius: number): number => (radius > 0 ? 0.57735 * radius + 0.5 : 0);

/**
 * One row's springs, written straight to its element's transform, opacity and filter, so a frame
 * never goes through React. Port of the motion in Android's LyricsListRow and LyricsLine.
 */
export class RowMotion {
  readonly offset: Spring;
  private readonly scale: Spring;
  private readonly alpha: Spring;
  private readonly blur: Spring;
  /** Background lines fade in and out; instrumental breaks grow and shrink with it. */
  readonly presence: Tween;
  private active = false;
  private written = { transform: "", opacity: "", filter: "", secondary: "", height: "" };
  private element: HTMLElement | null = null;
  private secondary: HTMLElement[] = [];

  constructor(
    target: RowTarget,
    private readonly kind: "line" | "background" | "indicator",
  ) {
    this.offset = new Spring(target.offset, SLOW_SPATIAL);
    this.scale = new Spring(target.scale, DEFAULT_SPATIAL);
    this.alpha = new Spring(target.alpha, DEFAULT_EFFECTS);
    this.blur = new Spring(target.blurRadius, SLOW_EFFECTS);
    this.presence = new Tween(target.presence ? 1 : 0);
    this.active = target.active;
  }

  update(target: RowTarget, options: RowMotionOptions): void {
    this.active = target.active;
    if (options.snap) {
      this.offset.snapTo(target.offset);
      this.scale.snapTo(target.scale);
      this.alpha.snapTo(target.alpha);
      this.blur.snapTo(options.blur ? target.blurRadius : 0);
      this.presence.snapTo(target.presence ? 1 : 0);
      return;
    }
    if (options.autoScroll) this.offset.animateTo(target.offset, target.staggerMs);
    this.scale.animateTo(target.scale);
    this.alpha.animateTo(target.alpha);
    this.blur.animateTo(options.blur ? target.blurRadius : 0);
    if (this.kind === "indicator") this.presence.animateTo(target.presence ? 1 : 0, INDICATOR_FADE_MS);
    else if (this.kind === "background") {
      if (target.presence) this.presence.animateTo(1, BACKGROUND_FADE_MS, BACKGROUND_FADE_DELAY_MS);
      else this.presence.animateTo(0, BACKGROUND_FADE_MS);
    }
  }

  /** Advances every spring; true while any still moves. */
  step(dtMs: number): boolean {
    const a = this.offset.step(dtMs);
    const b = this.scale.step(dtMs);
    const c = this.alpha.step(dtMs);
    const d = this.blur.step(dtMs);
    const e = this.presence.step(dtMs);
    return a || b || c || d || e;
  }

  /** The alpha a line's text is drawn at; the active line's colours already hold its alpha. */
  private lineAlpha(): number {
    if (this.active) return 1;
    return this.kind === "background" ? BACKGROUND_ALPHA : this.alpha.value;
  }

  /** A newly mounted element has none of the written styles yet. */
  attach(element: HTMLElement | null, secondary: HTMLElement[] = []): void {
    this.element = element;
    this.secondary = secondary;
    this.written = { transform: "", opacity: "", filter: "", secondary: "", height: "" };
  }

  write(manualOffset: number): void {
    const el = this.element;
    if (!el) return;
    if (this.kind === "indicator") {
      // A break grows into place, so the rows after it move down with it.
      const height = `${Math.round(INDICATOR_HEIGHT * this.presence.value * 100) / 100}px`;
      if (height !== this.written.height) {
        el.style.height = height;
        this.written.height = height;
      }
    }
    const y = Math.round((this.offset.value + manualOffset) * 100) / 100;
    const transform =
      this.kind === "indicator"
        ? `translate3d(0,${y}px,0)`
        : `translate3d(0,${y}px,0) scale(${Math.round(this.scale.value * 10000) / 10000})`;
    if (transform !== this.written.transform) {
      el.style.transform = transform;
      this.written.transform = transform;
    }
    const alpha = this.kind === "indicator" ? 1 : this.lineAlpha();
    const shown = this.kind === "line" ? 1 : this.presence.value;
    const opacity = String(Math.round(alpha * shown * 1000) / 1000);
    if (opacity !== this.written.opacity) {
      el.style.opacity = opacity;
      this.written.opacity = opacity;
    }
    const radius = Math.round(this.blur.value);
    const filter = radius > 0 ? `blur(${cssBlurOf(radius).toFixed(2)}px)` : "none";
    if (filter !== this.written.filter) {
      el.style.filter = filter;
      this.written.filter = filter;
    }
    if (this.secondary.length > 0) {
      // Android: the active line's extras at 0.72, others at 78% of the line, kept between 0.08 and 0.6.
      const relative = this.active ? 0.72 : alpha > 0 ? Math.min(0.6, Math.max(0.08, alpha * 0.78)) / alpha : 0;
      const value = String(Math.round(relative * 1000) / 1000);
      if (value !== this.written.secondary) {
        for (const node of this.secondary) node.style.opacity = value;
        this.written.secondary = value;
      }
    }
  }
}
