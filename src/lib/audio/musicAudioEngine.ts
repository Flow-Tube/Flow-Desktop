import { loudnessFactor, MUSIC_MAX_CUT_DB } from "../loudness";
import { IS_LINUX_RUNTIME, IS_MACOS_RUNTIME } from "../platform";
import { createAudioContext, keepRunning, resumeWithin, webAudioSupported } from "./audioContext";
import { fadeInGain, fadeOutGain, resetFade, scheduleFade, steppedFade } from "./crossfadeRamp";
import { EQ_GRAPH_OFF, type EqGraphSpec } from "./eq/graphPlan";
import { EqChain, RAMP_TIME_CONSTANT } from "./eqChain";
import { volumeGain } from "./volumeCurve";
import { webAudioHears } from "./webAudioFormats";

/**
 * One of the two <audio> elements. While one plays, the other can hold the next
 * track already buffered, so the change at a track boundary is a swap rather
 * than a fresh load.
 */
interface Slot {
  el: HTMLAudioElement | null;
  source: MediaElementAudioSourceNode | null;
  normGain: GainNode | null;
  /** The crossfade's share of this element, on the audio clock. */
  fadeGain: GainNode | null;
  /** The same share when WebAudio is not in use, applied to the element's volume. */
  fade: number;
  loudnessDb: number | null;
  /** The loaded file's MIME type, which decides whether WebAudio can hear it. */
  mime: string | null;
  /** The track a standby slot holds, so a swap only ever plays the right one. */
  key: string | null;
}

const emptySlot = (): Slot => ({
  el: null,
  source: null,
  normGain: null,
  fadeGain: null,
  fade: 1,
  loudnessDb: null,
  mime: null,
  key: null,
});

function unload(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  try {
    el.load();
  } catch {
  }
}

interface Fade {
  previous: Slot;
  done: ReturnType<typeof setTimeout>;
  cancelSteps: (() => void) | null;
}

class MusicAudioEngine {
  private slots: [Slot, Slot] = [emptySlot(), emptySlot()];
  private activeIndex: 0 | 1 = 0;
  private ctx: AudioContext | null = null;
  private chain: EqChain | null = null;
  private volGain: GainNode | null = null;

  private graphReady = false;
  private webAudioFailed = false;
  private availabilityListeners = new Set<(available: boolean) => void>();
  private graphListeners = new Set<() => void>();

  private volume = 1;
  private muted = false;
  /** The sleep timer's fade-out, from 1 (none) down to 0. */
  private fadeLevel = 1;
  private normalizationEnabled = true;
  private eqSpec: EqGraphSpec = EQ_GRAPH_OFF;
  private eqEngaged = false;
  private speed = 1;
  private crossfadeEnabled = false;
  private armedFadeSeconds: number | null = null;
  private fading: Fade | null = null;

  private get active(): Slot {
    return this.slots[this.activeIndex];
  }

  private get standby(): Slot {
    return this.slots[this.activeIndex === 0 ? 1 : 0];
  }

  // --- lifecycle ----------------------------------------------------------

  /** Bind the two hidden <audio> elements. Safe to call again on HMR. */
  attach(elements: [HTMLAudioElement, HTMLAudioElement]): void {
    if (this.slots[0].el === elements[0] && this.slots[1].el === elements[1]) return;
    this.slots = [emptySlot(), emptySlot()];
    this.activeIndex = 0;
    this.fading = null;
    for (const [i, el] of elements.entries()) {
      // Required for WebAudio to receive (non-silent) cross-origin samples.
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.preservesPitch = true;
      this.slots[i as 0 | 1].el = el;
    }
    this.graphReady = false;
    this.applySpeed();
    this.engageWhilePlaying();
    this.applyGain();
  }

  /** The element currently playing — the one whose events the player follows. */
  getActiveElement(): HTMLAudioElement | null {
    return this.active.el;
  }

  /**
   * Routes both elements through WebAudio. Done only once the equalizer changes the sound or
   * crossfade is on: a media element taken over by WebAudio can never play on its own again, and
   * loudness normalization only ever turns down, which the element's own volume does.
   */
  private ensureGraph(): void {
    if (this.graphReady || this.webAudioFailed || !this.slots[0].el || !this.slots[1].el) return;
    try {
      if (!this.ctx) {
        const ctx = createAudioContext();
        if (!ctx) throw new Error("No AudioContext");
        this.ctx = ctx;
        keepRunning(ctx, () => !!this.active.el && !this.active.el.paused);
      }
      const ctx = this.ctx;

      this.chain = new EqChain(ctx);
      this.volGain = ctx.createGain();
      this.chain.output.connect(this.volGain);
      this.volGain.connect(ctx.destination);

      // Each element keeps its own loudness and crossfade gains, since the two
      // hold different tracks; both feed the one shared EQ and volume chain.
      for (const slot of this.slots) {
        if (!slot.el) continue;
        slot.source = ctx.createMediaElementSource(slot.el);
        slot.normGain = ctx.createGain();
        slot.fadeGain = ctx.createGain();
        slot.fadeGain.gain.value = slot.fade;
        slot.source.connect(slot.normGain);
        slot.normGain.connect(slot.fadeGain);
        slot.fadeGain.connect(this.chain.input);
      }

      this.graphReady = true;
      this.applyGain();
      this.chain.apply(this.eqSpec);
      // Turned on mid-song: the context has to run for the element to be heard.
      if (this.active.el && !this.active.el.paused) void resumeWithin(ctx);
      for (const listener of this.graphListeners) listener();
    } catch (err) {
      console.warn("[musicAudioEngine] WebAudio graph unavailable, playing without the equalizer", err);
      this.webAudioFailed = true;
      this.notifyAvailability();
      this.applyGain();
    }
  }

  // --- transport ----------------------------------------------------------

  async load(url: string, mime: string | null): Promise<void> {
    const el = this.active.el;
    if (!el) return;
    this.active.key = null;
    this.active.mime = mime;
    this.applyGain();
    el.src = url;
    try {
      el.load();
    } catch {
    }
  }

  /**
   * Start buffering `url` on the standby element for the track `key`, so it can
   * take over the moment the current track ends. A no-op when it already holds
   * that track, or while it is still fading out the last one.
   */
  preload(key: string, url: string, loudnessDb: number | null, mime: string | null): void {
    const slot = this.standby;
    if (!slot.el || slot.key === key || this.fading) return;
    slot.key = key;
    slot.loudnessDb = loudnessDb;
    slot.mime = mime;
    slot.el.src = url;
    try {
      slot.el.load();
    } catch {
    }
    this.applyGain();
  }

  /** Whether the standby element holds `key` (buffered or still buffering). */
  hasPreloaded(key: string): boolean {
    return this.standby.key === key && !!this.standby.el?.getAttribute("src");
  }

  /**
   * Whether the standby element holds `key` with audio it can play right now.
   * One whose fetch failed or never delivered anything would stall forever if
   * swapped in, so it is skipped and the track loads the normal way.
   */
  canPlayPreloaded(key: string): boolean {
    const el = this.standby.el;
    return (
      this.hasPreloaded(key) &&
      !!el &&
      !el.error &&
      el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  /** Makes the next `activatePreloaded` a crossfade of `seconds` instead of a cut. */
  armCrossfade(seconds: number): void {
    this.armedFadeSeconds = seconds > 0 ? seconds : null;
  }

  /**
   * Make the standby element the active one when it holds `key`. The caller
   * then plays it; the element that was playing is emptied, at once or at the
   * end of an armed crossfade.
   */
  activatePreloaded(key: string): boolean {
    const fadeSeconds = this.armedFadeSeconds;
    this.armedFadeSeconds = null;
    if (!this.canPlayPreloaded(key)) return false;
    this.finishFade();
    const previous = this.active;
    this.activeIndex = this.activeIndex === 0 ? 1 : 0;
    this.active.key = null;
    if (fadeSeconds !== null && previous.el && !previous.el.paused) {
      this.startFade(previous, fadeSeconds);
    } else {
      this.release(previous);
    }
    this.applyGain();
    return true;
  }

  private release(slot: Slot): void {
    if (slot.el) unload(slot.el);
    slot.key = null;
    slot.loudnessDb = null;
    slot.mime = null;
  }

  // The two elements play together while their gains move in opposite directions; the one
  // fading out is emptied when the fade ends.
  private startFade(previous: Slot, seconds: number): void {
    const next = this.active;
    let cancelSteps: (() => void) | null = null;
    if (this.ctx && this.routes(previous) && this.routes(next) && previous.fadeGain && next.fadeGain) {
      const t = this.ctx.currentTime;
      scheduleFade(previous.fadeGain.gain, "out", t, seconds);
      scheduleFade(next.fadeGain.gain, "in", t, seconds);
    } else {
      cancelSteps = steppedFade(seconds, (progress) => {
        previous.fade = fadeOutGain(progress);
        next.fade = fadeInGain(progress);
        this.applyGain();
      });
    }
    const done = setTimeout(() => this.finishFade(), seconds * 1_000 + 50);
    this.fading = { previous, done, cancelSteps };
  }

  /** Ends a crossfade now: the outgoing element is emptied and both gains return to full. */
  private finishFade(): void {
    const fading = this.fading;
    if (!fading) return;
    this.fading = null;
    clearTimeout(fading.done);
    fading.cancelSteps?.();
    this.release(fading.previous);
    for (const slot of this.slots) {
      slot.fade = 1;
      if (this.ctx && slot.fadeGain) resetFade(slot.fadeGain.gain, this.ctx.currentTime);
    }
    this.applyGain();
    // A speed change made during the fade was held back on Linux; apply it now.
    this.applySpeed();
  }

  /** Drop whatever the standby element holds, returning the track it was. */
  clearPreload(): string | null {
    this.finishFade();
    const slot = this.standby;
    const key = slot.key;
    if (key === null) return null;
    this.release(slot);
    return key;
  }

  /** Loudness of the track now playing, as recorded when it was loaded. */
  getActiveLoudness(): number | null {
    return this.active.loudnessDb;
  }

  /**
   * Seek once the element knows its duration. Setting `currentTime` on an
   * element still fetching metadata is ignored by WebKit.
   */
  seekWhenReady(seconds: number): void {
    const el = this.active.el;
    if (!el || !Number.isFinite(seconds) || seconds <= 0) return;
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      el.currentTime = seconds;
      return;
    }
    el.addEventListener("loadedmetadata", () => {
      if (this.active.el === el) el.currentTime = seconds;
    }, { once: true });
  }

  async play(): Promise<void> {
    const el = this.active.el;
    if (!el) return;
    if (this.needsGraph()) this.ensureGraph();
    if (this.ctx) await resumeWithin(this.ctx);
    try {
      await el.play();
    } catch (err) {
      console.warn("[musicAudioEngine] play() rejected", err);
    }
  }

  /** The audio context's state, for start-up diagnostics. */
  getContextState(): AudioContextState | "none" {
    return this.ctx?.state ?? "none";
  }

  pause(): void {
    this.finishFade();
    this.active.el?.pause();
  }

  stop(): void {
    this.finishFade();
    for (const slot of this.slots) this.release(slot);
  }

  seek(seconds: number): void {
    const el = this.active.el;
    if (el && Number.isFinite(seconds)) {
      el.currentTime = Math.max(0, seconds);
    }
  }

  getCurrentTime(): number {
    return this.active.el?.currentTime ?? 0;
  }

  /** Seconds buffered ahead on the playing element, for stall detection. */
  getBufferedEnd(): number {
    const el = this.active.el;
    if (!el || el.buffered.length === 0) return 0;
    return el.buffered.end(el.buffered.length - 1);
  }

  /** The playing element's `MediaError` code, or null while it has none. */
  getErrorCode(): number | null {
    return this.active.el?.error?.code ?? null;
  }

  getDuration(): number {
    const d = this.active.el?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  // --- speed --------------------------------------------------------------

  setSpeed(rate: number): void {
    this.speed = Math.max(0.5, Math.min(2, rate));
    this.applySpeed();
  }

  /**
   * WebKitGTK flushes its GStreamer pipeline on every `playbackRate` write, so the rate is only
   * written when it differs, and on Linux not while two elements are crossfading. The default
   * rate carries it across loads, which reset `playbackRate` to it.
   */
  private applySpeed(): void {
    if (IS_LINUX_RUNTIME && this.fading) return;
    for (const slot of this.slots) {
      const el = slot.el;
      if (!el) continue;
      if (el.defaultPlaybackRate !== this.speed) el.defaultPlaybackRate = this.speed;
      if (el.playbackRate !== this.speed) el.playbackRate = this.speed;
    }
  }

  // --- gain (volume + loudness normalization) -----------------------------

  /** `volume` is the slider position; it plays on a perceptual curve. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Loudness of the track now playing, and whether to normalize to it. */
  setLoudness(loudnessDb: number | null, enabled: boolean): void {
    this.active.loudnessDb = loudnessDb;
    this.normalizationEnabled = enabled;
    this.applyGain();
  }

  private normalizationFactor(loudnessDb: number | null): number {
    return loudnessFactor(loudnessDb, this.normalizationEnabled, MUSIC_MAX_CUT_DB);
  }

  /**
   * Fades the music to silence by the time `remainingSeconds` have passed,
   * from `level` now. With WebAudio the ramp runs on the audio clock, so it
   * keeps going while timers are throttled in a hidden window; without it the
   * element's volume steps down each time this is called again.
   */
  fadeOut(level: number, remainingSeconds: number): void {
    this.fadeLevel = Math.max(0, Math.min(1, level));
    if (this.graphReady && this.ctx && this.volGain) {
      const gain = this.volGain.gain;
      const t = this.ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime((this.muted ? 0 : volumeGain(this.volume)) * this.fadeLevel, t);
      gain.linearRampToValueAtTime(0, t + Math.max(0, remainingSeconds));
      return;
    }
    this.applyGain();
  }

  /** Back to full volume after a fade-out stopped or was cancelled. */
  resetFade(): void {
    if (this.fadeLevel === 1) return;
    this.fadeLevel = 1;
    if (this.graphReady && this.ctx && this.volGain) this.volGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.applyGain();
  }

  private applyGain(): void {
    const vol = (this.muted ? 0 : volumeGain(this.volume)) * this.fadeLevel;

    const t = this.ctx?.currentTime ?? 0;
    if (this.graphReady && this.volGain) this.volGain.gain.setTargetAtTime(vol, t, RAMP_TIME_CONSTANT);
    // A scheduled crossfade owns the fade gains until it ends; a stepped one moves `slot.fade`.
    const scheduledFade = !!this.fading && !this.fading.cancelSteps;
    for (const slot of this.slots) {
      if (!slot.el) continue;
      const norm = this.normalizationFactor(slot.loudnessDb);
      if (this.routes(slot)) {
        slot.normGain?.gain.setTargetAtTime(norm, t, RAMP_TIME_CONSTANT);
        if (!scheduledFade) slot.fadeGain?.gain.setTargetAtTime(slot.fade, t, RAMP_TIME_CONSTANT);
        slot.el.volume = 1;
        slot.el.muted = false;
      } else {
        slot.el.volume = Math.max(0, Math.min(1, vol * norm * slot.fade));
        slot.el.muted = this.muted;
      }
    }
  }

  /** Whether `slot` plays through the graph, rather than past it on its own volume. */
  private routes(slot: Slot): boolean {
    return this.graphReady && !!slot.source && webAudioHears(slot.mime);
  }

  // --- crossfade ----------------------------------------------------------

  /** Crossfades are timed on the audio clock, so turning them on brings WebAudio in. */
  setCrossfadeEnabled(enabled: boolean): void {
    this.crossfadeEnabled = enabled;
    this.engageWhilePlaying();
  }

  // --- equalizer ----------------------------------------------------------

  /**
   * The curve to run, and whether it changes the sound. The graph is built the first time it
   * does; after that every change, including switching off, only glides the filters.
   */
  setEq(spec: EqGraphSpec, engaged: boolean): void {
    this.eqSpec = spec;
    this.eqEngaged = engaged;
    this.engageWhilePlaying();
    this.chain?.apply(spec);
  }

  private needsGraph(): boolean {
    return this.eqEngaged || this.crossfadeEnabled;
  }

  /**
   * Builds the graph now when music is playing (a change the user just made), otherwise on the
   * next play: a context made at startup, outside any click, may never be allowed to run.
   */
  private engageWhilePlaying(): void {
    if (this.needsGraph() && this.active.el && !this.active.el.paused) this.ensureGraph();
  }

  /**
   * Whether streams should come as AAC: on macOS only MP4 audio reaches the graph, and once the
   * graph is in use every song plays through it.
   */
  wantsAac(): boolean {
    return IS_MACOS_RUNTIME && (this.graphReady || this.needsGraph());
  }

  /** Whether the song playing bypasses the graph, so the equalizer cannot be heard on it. */
  activeBypassesGraph(): boolean {
    return this.graphReady && !!this.active.el?.getAttribute("src") && !this.routes(this.active);
  }

  /** Called once the graph is built, when songs loaded before it may need loading again. */
  onGraphReady(listener: () => void): () => void {
    this.graphListeners.add(listener);
    return () => this.graphListeners.delete(listener);
  }

  /** False once WebAudio failed here, so the equalizer cannot be heard. */
  isEqAvailable(): boolean {
    return !this.webAudioFailed && webAudioSupported();
  }

  onEqAvailabilityChange(listener: (available: boolean) => void): () => void {
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  private notifyAvailability(): void {
    for (const listener of this.availabilityListeners) listener(this.isEqAvailable());
  }
}

// Module singleton — survives route changes (lives outside the React tree).
export const musicAudioEngine = new MusicAudioEngine();
