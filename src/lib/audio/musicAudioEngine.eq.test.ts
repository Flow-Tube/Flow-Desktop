import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { graphSpec, EQ_GRAPH_OFF } from "./eq/graphPlan";
import { defaultEqState, selectPreset } from "./eq/stateOps";
import { musicAudioEngine } from "./musicAudioEngine";

const platform = vi.hoisted(() => ({ macos: false }));
vi.mock("../platform", () => ({
  IS_LINUX_RUNTIME: false,
  get IS_MACOS_RUNTIME() {
    return platform.macos;
  },
}));

// A minimal WebAudio stand-in: enough to see which nodes exist and what they were told.
class FakeParam {
  constructor(public value = 0) {}
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  cancelScheduledValues = vi.fn();
  setValueCurveAtTime = vi.fn((curve: Float32Array, _start: number, _seconds: number) => {
    this.value = curve[curve.length - 1] ?? this.value;
  });
}
class FakeNode {
  connect = vi.fn((node: unknown) => node);
}
class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
class FakeBiquad extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}
class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
}

const contexts: FakeContext[] = [];
class FakeContext extends EventTarget {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  biquads: FakeBiquad[] = [];
  gains: FakeGain[] = [];
  sources: HTMLMediaElement[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  constructor() {
    super();
    contexts.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    const f = new FakeBiquad();
    this.biquads.push(f);
    return f;
  }
  createWaveShaper() {
    return new FakeShaper();
  }
  createMediaElementSource(el: HTMLMediaElement) {
    this.sources.push(el);
    return new FakeNode();
  }
}

const elements = (): [HTMLAudioElement, HTMLAudioElement] => {
  const pair = [document.createElement("audio"), document.createElement("audio")] as [
    HTMLAudioElement,
    HTMLAudioElement,
  ];
  for (const el of pair) {
    el.load = vi.fn();
    el.pause = vi.fn();
    el.play = vi.fn(async () => {});
  }
  return pair;
};

const rock = graphSpec(selectPreset(defaultEqState(), "builtin:rock"), false);

// The engine is a singleton that keeps its context, so tests share the last one made.
const lastContext = () => contexts[contexts.length - 1]!;

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeContext);
});

afterEach(() => {
  platform.macos = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("music EQ graph", () => {
  it("plays straight from the elements until the equalizer changes the sound", () => {
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(EQ_GRAPH_OFF, false);
    musicAudioEngine.setVolume(0.5);
    musicAudioEngine.setLoudness(6, true);

    expect(contexts).toHaveLength(0);
    // Half way on the slider is a quarter of the gain, and 6 dB over the target halves it again.
    expect(pair[0].volume).toBeCloseTo(0.125, 2);
    expect(musicAudioEngine.isEqAvailable()).toBe(true);
  });

  it("builds one chain of 20 filters plus bass boost on play, and keeps it through a gapless swap", async () => {
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(rock, true);
    // Nothing is playing yet: the context waits for the play that a click starts.
    expect(contexts).toHaveLength(0);
    await musicAudioEngine.play();

    const ctx = lastContext();
    expect(ctx.sources).toEqual(pair);
    expect(ctx.biquads).toHaveLength(21);
    expect(ctx.biquads[0]!.gain.value).toBe(rock.bands[0]!.gain);
    expect(ctx.biquads[5]!.gain.value).toBe(0);

    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    musicAudioEngine.preload("b", "http://127.0.0.1/stream/b", null, null);
    Object.defineProperty(pair[1], "readyState", { value: HTMLMediaElement.HAVE_FUTURE_DATA, configurable: true });
    expect(musicAudioEngine.activatePreloaded("b")).toBe(true);

    // No new sources or filters: the swap only changes which element is heard.
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.biquads).toHaveLength(21);
    expect(ctx.biquads[0]!.gain.value).toBe(rock.bands[0]!.gain);

    musicAudioEngine.setEq(EQ_GRAPH_OFF, false);
    expect(ctx.biquads.every((f) => f.gain.value === 0)).toBe(true);
  });

  it("asks for AAC on macOS, and keeps a WebM song it cannot hear on the element's volume", async () => {
    platform.macos = true;
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(EQ_GRAPH_OFF, false);
    expect(musicAudioEngine.wantsAac()).toBe(false);
    musicAudioEngine.setEq(rock, true);
    expect(musicAudioEngine.wantsAac()).toBe(true);

    await musicAudioEngine.load("http://127.0.0.1/stream/opus", 'audio/webm; codecs="opus"');
    await musicAudioEngine.play();
    musicAudioEngine.setLoudness(null, true);
    musicAudioEngine.setVolume(0.5);
    expect(musicAudioEngine.activeBypassesGraph()).toBe(true);
    expect(pair[0].volume).toBeCloseTo(0.25, 2);

    await musicAudioEngine.load("http://127.0.0.1/stream/aac", 'audio/mp4; codecs="mp4a.40.2"');
    expect(musicAudioEngine.activeBypassesGraph()).toBe(false);
    expect(pair[0].volume).toBe(1);
  });

  it("starts the element even when the context will not resume", async () => {
    vi.useFakeTimers();
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(rock, true);
    await musicAudioEngine.play();
    const ctx = lastContext();
    ctx.state = "suspended";
    ctx.resume.mockImplementation(() => new Promise(() => {}));

    const started = musicAudioEngine.play();
    await vi.advanceTimersByTimeAsync(500);
    await started;
    expect(pair[0].play).toHaveBeenCalled();
  });

  it("resumes the context when the system suspends it mid-song", () => {
    const pair = elements();
    musicAudioEngine.attach(pair);
    Object.defineProperty(pair[0], "paused", { value: false, configurable: true });
    // Turned on while a song plays, the graph is built at once.
    musicAudioEngine.setEq(rock, true);
    const ctx = lastContext();
    expect(ctx.sources).toContain(pair[0]);

    ctx.state = "suspended";
    ctx.dispatchEvent(new Event("statechange"));
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("crossfades into a buffered song on the audio clock, then empties the one that ended", async () => {
    vi.useFakeTimers();
    const pair = elements();
    musicAudioEngine.attach(pair);
    Object.defineProperty(pair[0], "paused", { value: false, configurable: true });
    musicAudioEngine.setCrossfadeEnabled(true);
    const ctx = lastContext();
    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    musicAudioEngine.preload("b", "http://127.0.0.1/stream/b", null, null);
    Object.defineProperty(pair[1], "readyState", { value: HTMLMediaElement.HAVE_FUTURE_DATA, configurable: true });

    musicAudioEngine.armCrossfade(4);
    expect(musicAudioEngine.activatePreloaded("b")).toBe(true);

    expect(musicAudioEngine.getActiveElement()).toBe(pair[1]);
    expect(pair[0].getAttribute("src")).toBe("http://127.0.0.1/stream/a");
    const fades = ctx.gains.filter((g) => g.gain.setValueCurveAtTime.mock.calls.length > 0);
    expect(fades).toHaveLength(2);
    expect(fades.every((g) => g.gain.setValueCurveAtTime.mock.calls[0]![2] === 4)).toBe(true);

    await vi.advanceTimersByTimeAsync(4_100);
    expect(pair[0].getAttribute("src")).toBeNull();
    musicAudioEngine.setCrossfadeEnabled(false);
  });
});

describe("crossfade without WebAudio", () => {
  it("steps the two elements' volume instead", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", undefined);
    vi.resetModules();
    const { musicAudioEngine: engine } = await import("./musicAudioEngine");
    const pair = elements();
    engine.attach(pair);
    engine.setCrossfadeEnabled(true);
    expect(engine.isEqAvailable()).toBe(false);

    await engine.load("http://127.0.0.1/stream/a", null);
    engine.preload("b", "http://127.0.0.1/stream/b", null, null);
    Object.defineProperty(pair[1], "readyState", { value: HTMLMediaElement.HAVE_FUTURE_DATA, configurable: true });
    Object.defineProperty(pair[0], "paused", { value: false, configurable: true });
    engine.armCrossfade(2);
    engine.activatePreloaded("b");

    expect(pair[1].volume).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pair[0].volume).toBeGreaterThan(0.6);
    expect(pair[0].volume).toBeLessThan(0.8);
    expect(pair[1].volume).toBeCloseTo(pair[0].volume, 1);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(pair[1].volume).toBe(1);
    expect(pair[0].getAttribute("src")).toBeNull();
  });
});
