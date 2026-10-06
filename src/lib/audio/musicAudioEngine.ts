import {
  EQ_BANDS,
  EQ_PEAKING_Q,
  normalizeEqGains,
} from "./eqBands";

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  );
}

/**
 * One of the two <audio> elements. While one plays, the other can hold the next
 * track already buffered, so the change at a track boundary is a swap rather
 * than a fresh load.
 */
interface Slot {
  el: HTMLAudioElement | null;
  source: MediaElementAudioSourceNode | null;
  normGain: GainNode | null;
  loudnessDb: number | null;
  /** The track a standby slot holds, so a swap only ever plays the right one. */
  key: string | null;
}

const emptySlot = (): Slot => ({ el: null, source: null, normGain: null, loudnessDb: null, key: null });

function unload(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  try {
    el.load();
  } catch {
  }
}

class MusicAudioEngine {
  private slots: [Slot, Slot] = [emptySlot(), emptySlot()];
  private activeIndex: 0 | 1 = 0;
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private volGain: GainNode | null = null;

  private graphReady = false;
  private webAudioFailed = false;

  private volume = 1;
  private muted = false;
  private eqEnabled = false;
  private eqGains: number[] = normalizeEqGains(null);
  private normalizationEnabled = true;

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
    for (const [i, el] of elements.entries()) {
      // Required for WebAudio to receive (non-silent) cross-origin samples.
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      this.slots[i as 0 | 1].el = el;
    }
    // Rebuild the graph lazily on the next play()
    this.graphReady = false;
    this.applyGain();
  }

  /** The element currently playing — the one whose events the player follows. */
  getActiveElement(): HTMLAudioElement | null {
    return this.active.el;
  }

  private ensureGraph(): void {
    if (this.graphReady || this.webAudioFailed || !this.active.el) return;
    try {
      const Ctor = getAudioContextCtor();
      if (!Ctor) {
        this.webAudioFailed = true;
        return;
      }
      if (!this.ctx) this.ctx = new Ctor();
      const ctx = this.ctx;

      this.filters = EQ_BANDS.map((band) => {
        const f = ctx.createBiquadFilter();
        f.type = band.type;
        f.frequency.value = band.frequency;
        f.Q.value = EQ_PEAKING_Q;
        f.gain.value = 0;
        return f;
      });
      this.volGain = ctx.createGain();
      const chainStart = this.filters.reduceRight<AudioNode>((next, filter) => {
        filter.connect(next);
        return filter;
      }, this.volGain);
      this.volGain.connect(ctx.destination);

      // Each element keeps its own loudness gain, since the two hold different
      // tracks; both feed the one shared EQ and volume chain.
      for (const slot of this.slots) {
        if (!slot.el) continue;
        slot.source = ctx.createMediaElementSource(slot.el);
        slot.normGain = ctx.createGain();
        slot.source.connect(slot.normGain);
        slot.normGain.connect(chainStart);
      }

      this.graphReady = true;
      this.applyGain();
      this.applyEq();
    } catch (err) {
      console.warn(
        "[musicAudioEngine] WebAudio graph unavailable — degrading to element volume",
        err,
      );
      this.webAudioFailed = true;
      this.applyGain();
    }
  }

  // --- transport ----------------------------------------------------------

  async load(url: string): Promise<void> {
    const el = this.active.el;
    if (!el) return;
    this.active.key = null;
    el.src = url;
    try {
      el.load();
    } catch {
    }
  }

  /**
   * Start buffering `url` on the standby element for the track `key`, so it can
   * take over the moment the current track ends. A no-op when it already holds
   * that track.
   */
  preload(key: string, url: string, loudnessDb: number | null): void {
    const slot = this.standby;
    if (!slot.el || slot.key === key) return;
    slot.key = key;
    slot.loudnessDb = loudnessDb;
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
  private preloadIsPlayable(key: string): boolean {
    const el = this.standby.el;
    return (
      this.hasPreloaded(key) &&
      !!el &&
      !el.error &&
      el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  /**
   * Make the standby element the active one when it holds `key`. The caller
   * then plays it; the element that was playing is emptied.
   */
  activatePreloaded(key: string): boolean {
    if (!this.preloadIsPlayable(key)) return false;
    const previous = this.active;
    this.activeIndex = this.activeIndex === 0 ? 1 : 0;
    this.active.key = null;
    if (previous.el) unload(previous.el);
    previous.key = null;
    previous.loudnessDb = null;
    this.applyGain();
    return true;
  }

  /** Drop whatever the standby element holds, returning the track it was. */
  clearPreload(): string | null {
    const slot = this.standby;
    const key = slot.key;
    if (key === null) return null;
    slot.key = null;
    slot.loudnessDb = null;
    if (slot.el) unload(slot.el);
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
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
      }
    }
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
    this.active.el?.pause();
  }

  stop(): void {
    for (const slot of this.slots) {
      slot.key = null;
      slot.loudnessDb = null;
      if (slot.el) unload(slot.el);
    }
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

  getDuration(): number {
    const d = this.active.el?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  // --- gain (volume + loudness normalization) -----------------------------

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
    if (!this.normalizationEnabled || loudnessDb == null) return 1;
    return Math.min(1, Math.pow(10, -loudnessDb / 20));
  }

  private applyGain(): void {
    const vol = this.muted ? 0 : this.volume;

    if (this.graphReady && this.ctx && this.volGain) {
      const t = this.ctx.currentTime;
      this.volGain.gain.setTargetAtTime(vol, t, 0.012);
      for (const slot of this.slots) {
        slot.normGain?.gain.setTargetAtTime(this.normalizationFactor(slot.loudnessDb), t, 0.012);
        if (slot.el) {
          slot.el.volume = 1;
          slot.el.muted = false;
        }
      }
    } else {
      for (const slot of this.slots) {
        if (!slot.el) continue;
        const norm = this.normalizationFactor(slot.loudnessDb);
        slot.el.volume = Math.max(0, Math.min(1, vol * norm));
        slot.el.muted = this.muted;
      }
    }
  }

  // --- equalizer ----------------------------------------------------------

  setEqEnabled(enabled: boolean): void {
    this.eqEnabled = enabled;
    this.applyEq();
  }

  setEqGains(gains: number[]): void {
    this.eqGains = normalizeEqGains(gains);
    this.applyEq();
  }

  setEqBand(index: number, gainDb: number): void {
    if (index < 0 || index >= this.eqGains.length) return;
    const next = [...this.eqGains];
    next[index] = gainDb;
    this.eqGains = normalizeEqGains(next);
    this.applyEq();
  }

  private applyEq(): void {
    if (!this.graphReady || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.filters.forEach((f, i) => {
      const g = this.eqEnabled ? this.eqGains[i] ?? 0 : 0;
      f.gain.setTargetAtTime(g, t, 0.012);
    });
  }
}

// Module singleton — survives route changes (lives outside the React tree).
export const musicAudioEngine = new MusicAudioEngine();
