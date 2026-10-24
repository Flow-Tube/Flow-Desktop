import { logToBackend } from "../diagnostics";
import { createAudioContext, keepRunning, resumeWithin } from "./audioContext";
import { EQ_GRAPH_OFF, type EqGraphSpec } from "./eq/graphPlan";
import { EqChain } from "./eqChain";
import { probeMediaElementRouting } from "./webAudioProbe";

// One context for every video player in this window; each player keeps its own chain.
let sharedContext: AudioContext | null = null;
let routingWorks: Promise<boolean | null> | null = null;
// WebAudio failed or delivered silence in this window: video plays from its elements alone.
let unavailable = false;
const routedElements = new Set<HTMLMediaElement>();

function videoContext(): AudioContext | null {
  if (!sharedContext) {
    sharedContext = createAudioContext();
    if (sharedContext) keepRunning(sharedContext, () => [...routedElements].some((el) => !el.paused));
  }
  return sharedContext;
}

/** Runs the routing self-test once per window; a test that could not run is tried again later. */
function checkRouting(ctx: AudioContext): Promise<boolean | null> {
  routingWorks ??= probeMediaElementRouting(ctx).then((works) => {
    if (works === null) routingWorks = null;
    if (works === false) {
      unavailable = true;
      void logToBackend("warn", "video equalizer off: WebAudio returned silence from a media element");
    }
    return works;
  });
  return routingWorks;
}

/**
 * The equalizer for one video player: its <video> element and the separate <audio> element
 * adaptive playback uses. Elements are routed through WebAudio only once the equalizer changes
 * the sound, and each gets its source node exactly once in its life, as WebAudio requires.
 */
export class MediaEqEngine {
  private chain: EqChain | null = null;
  private elements: HTMLMediaElement[] = [];
  private sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private watched = new WeakSet<HTMLMediaElement>();
  private spec: EqGraphSpec = EQ_GRAPH_OFF;
  private engaged = false;
  private routing = false;

  /** The player's current media elements; an element that left is let go. */
  setElements(elements: (HTMLMediaElement | null)[]): void {
    const next = elements.filter((el): el is HTMLMediaElement => el !== null);
    for (const el of this.elements) {
      if (next.includes(el)) continue;
      this.sources.get(el)?.disconnect();
      routedElements.delete(el);
    }
    this.elements = next;
    for (const el of next) {
      if (this.watched.has(el)) continue;
      this.watched.add(el);
      // A routed element needs its context running; one not routed yet gets another chance,
      // since the self-test needs a context the webview lets run.
      el.addEventListener("play", () => {
        if (routedElements.has(el) && sharedContext) void resumeWithin(sharedContext);
        else if (this.engaged) void this.route();
      });
    }
    if (this.engaged) void this.route();
  }

  setEq(spec: EqGraphSpec, engaged: boolean): void {
    this.spec = spec;
    this.engaged = engaged;
    if (engaged) void this.route();
    this.chain?.apply(spec);
  }

  dispose(): void {
    this.setElements([]);
    this.chain?.output.disconnect();
    this.chain = null;
  }

  private async route(): Promise<void> {
    if (unavailable || this.routing) return;
    const ctx = videoContext();
    if (!ctx) {
      unavailable = true;
      return;
    }
    this.routing = true;
    try {
      if ((await checkRouting(ctx)) !== true || !this.engaged) return;
      if (!this.chain) {
        this.chain = new EqChain(ctx);
        this.chain.output.connect(ctx.destination);
        this.chain.apply(this.spec);
      }
      for (const el of this.elements) this.connect(ctx, this.chain, el);
    } catch (error) {
      unavailable = true;
      console.warn("[mediaEqEngine] WebAudio unavailable, video plays without the equalizer", error);
    } finally {
      this.routing = false;
    }
  }

  private connect(ctx: AudioContext, chain: EqChain, el: HTMLMediaElement): void {
    if (this.sources.has(el) && routedElements.has(el)) return;
    // Without CORS from the start the samples reach WebAudio as silence.
    if (el.crossOrigin !== "anonymous") return;
    let source = this.sources.get(el);
    if (!source) {
      source = ctx.createMediaElementSource(el);
      this.sources.set(el, source);
      void logToBackend("info", "video equalizer routed", {
        element: el.tagName.toLowerCase(),
        baseLatencyMs: Math.round(ctx.baseLatency * 1_000),
        outputLatencyMs: Math.round((ctx.outputLatency ?? 0) * 1_000),
      });
    }
    source.connect(chain.input);
    routedElements.add(el);
    if (!el.paused) void resumeWithin(ctx);
  }
}

/** False once WebAudio failed or proved silent for video in this window. */
export const videoEqAvailable = (): boolean => !unavailable;
