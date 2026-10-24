import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { graphSpec, EQ_GRAPH_OFF } from "./eq/graphPlan";
import { defaultEqState, selectPreset } from "./eq/stateOps";
import { musicAudioEngine } from "./musicAudioEngine";

// A minimal WebAudio stand-in: enough to see which nodes exist and what they were told.
class FakeParam {
  constructor(public value = 0) {}
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
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
  sources: HTMLMediaElement[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  constructor() {
    super();
    contexts.push(this);
  }
  createGain() {
    return new FakeGain();
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

  it("builds one chain of 20 filters plus bass boost, and keeps it through a gapless swap", async () => {
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(rock, true);

    const ctx = lastContext();
    expect(ctx.sources).toEqual(pair);
    expect(ctx.biquads).toHaveLength(21);
    expect(ctx.biquads[0]!.gain.value).toBe(rock.bands[0]!.gain);
    expect(ctx.biquads[5]!.gain.value).toBe(0);

    await musicAudioEngine.load("http://127.0.0.1/stream/a");
    musicAudioEngine.preload("b", "http://127.0.0.1/stream/b", null);
    Object.defineProperty(pair[1], "readyState", { value: HTMLMediaElement.HAVE_FUTURE_DATA, configurable: true });
    expect(musicAudioEngine.activatePreloaded("b")).toBe(true);

    // No new sources or filters: the swap only changes which element is heard.
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.biquads).toHaveLength(21);
    expect(ctx.biquads[0]!.gain.value).toBe(rock.bands[0]!.gain);

    musicAudioEngine.setEq(EQ_GRAPH_OFF, false);
    expect(ctx.biquads.every((f) => f.gain.value === 0)).toBe(true);
  });

  it("starts the element even when the context will not resume", async () => {
    vi.useFakeTimers();
    const pair = elements();
    musicAudioEngine.attach(pair);
    musicAudioEngine.setEq(rock, true);
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
    musicAudioEngine.setEq(rock, true);
    const ctx = lastContext();
    Object.defineProperty(pair[0], "paused", { value: false, configurable: true });

    ctx.state = "suspended";
    ctx.dispatchEvent(new Event("statechange"));
    expect(ctx.resume).toHaveBeenCalled();
  });
});
