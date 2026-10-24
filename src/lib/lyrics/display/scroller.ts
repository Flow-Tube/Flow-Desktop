import type { LyricsPanelState } from "./panelState";
import { Fling, Tween } from "./motion";

const PREVIEW_MS = 8000;
const FLING_FRICTION = 1.8;
const TOUCH_SLOP = 8;
const VELOCITY_WINDOW_MS = 100;
const MIN_FLING_VELOCITY = 50;

interface Drag {
  id: number;
  lastY: number;
  total: number;
  dragging: boolean;
  samples: Array<[number, number]>;
}

/**
 * The manual scroll of the lyrics panel, ported from Android's InlineLyricsPanel: wheel and drag
 * move it within the panel's bounds, a fling decays with friction 1.8, and eight seconds after the
 * last scroll the panel follows the song again while the offset eases home.
 */
export class LyricsScroller {
  private fling: Fling | null = null;
  private settle: { tween: Tween; last: number } | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: Drag | null = null;
  private dragged = false;
  bounds = { min: 0, max: 0 };

  constructor(
    private readonly state: LyricsPanelState,
    /** Called when the scroll changes what the panel has to render: the mode or its offset. */
    private readonly onChange: (modeChanged: boolean) => void,
  ) {}

  private clamp(value: number): number {
    return Math.min(this.bounds.max, Math.max(this.bounds.min, value));
  }

  scrollTo(next: number): void {
    const clamped = this.clamp(next);
    if (clamped === this.state.userManualOffset) return;
    const wasAuto = this.state.isAutoScrollEnabled;
    this.settle = null;
    this.state.onUserScroll(clamped, Date.now());
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.state.resumeAutoScroll();
      this.onChange(true);
    }, PREVIEW_MS);
    this.onChange(wasAuto);
  }

  wheel(deltaPx: number): void {
    this.fling = null;
    this.scrollTo(this.state.userManualOffset - deltaPx);
  }

  pointerDown(id: number, y: number, time: number): void {
    this.fling = null;
    this.dragged = false;
    this.drag = { id, lastY: y, total: 0, dragging: false, samples: [[time, y]] };
  }

  /** True once the pointer has moved far enough to be a drag; the caller then captures it. */
  pointerMove(id: number, y: number, time: number): boolean {
    const d = this.drag;
    if (!d || d.id !== id) return false;
    const delta = y - d.lastY;
    d.lastY = y;
    d.total += Math.abs(delta);
    if (!d.dragging && d.total > TOUCH_SLOP) d.dragging = true;
    if (!d.dragging) return false;
    d.samples.push([time, y]);
    if (d.samples.length > 8) d.samples.shift();
    this.scrollTo(this.state.userManualOffset + delta);
    return true;
  }

  pointerUp(id: number, time: number): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.id !== id || !d.dragging) return;
    this.dragged = true;
    const recent = d.samples.filter(([t]) => time - t < VELOCITY_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const velocity = first && last && last[0] > first[0] ? ((last[1] - first[1]) / (last[0] - first[0])) * 1000 : 0;
    if (Math.abs(velocity) > MIN_FLING_VELOCITY) this.fling = new Fling(this.state.userManualOffset, velocity, FLING_FRICTION);
  }

  /** A click that ended a drag is not a tap on a line. */
  consumeDragClick(): boolean {
    const dragged = this.dragged;
    this.dragged = false;
    return dragged;
  }

  /** Back on auto scroll: the offset eases home over 200 to 600 ms, as Android's tween does. */
  settleHome(): void {
    this.fling = null;
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    const start = this.state.userManualOffset;
    if (Math.abs(start) < 1) {
      this.state.userManualOffset = 0;
      this.settle = null;
      return;
    }
    const tween = new Tween(start);
    tween.animateTo(0, Math.min(600, Math.max(200, Math.abs(start) / 4)));
    this.settle = { tween, last: start };
  }

  stop(): void {
    this.fling = null;
    this.settle = null;
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  /** Advances a fling or the ease home; true while either still moves. */
  step(dtMs: number): boolean {
    let moving = false;
    if (this.fling) {
      const { value, moving: still } = this.fling.step(dtMs);
      const clamped = this.clamp(value);
      this.state.userManualOffset = clamped;
      if (!still || clamped !== value) this.fling = null;
      else moving = true;
      this.onChange(false);
    }
    const settle = this.settle;
    if (settle) {
      const going = settle.tween.step(dtMs);
      this.state.userManualOffset += settle.tween.value - settle.last;
      settle.last = settle.tween.value;
      if (going) moving = true;
      else {
        this.state.userManualOffset = 0;
        this.settle = null;
      }
    }
    return moving;
  }

  /** Keeps a manual scroll inside new bounds. */
  setBounds(min: number, max: number): void {
    this.bounds = { min: Math.min(min, max), max: Math.max(min, max) };
    this.state.userManualOffset = this.clamp(this.state.userManualOffset);
  }
}
