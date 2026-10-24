import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../diagnostics", () => ({ logToBackend: vi.fn(async () => {}) }));

import { graphSpec } from "./eq/graphPlan";
import { defaultEqState, selectPreset } from "./eq/stateOps";

class FakeParam {
  value = 1;
  setTargetAtTime = vi.fn((v: number) => {
    this.value = v;
  });
}
class FakeNode {
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}
let probeSignal = 0.2;
const contexts: FakeContext[] = [];
class FakeContext extends EventTarget {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 48_000;
  baseLatency = 0.005;
  outputLatency = 0.02;
  destination = new FakeNode();
  sources: HTMLMediaElement[] = [];
  resume = vi.fn(async () => {});
  constructor() {
    super();
    contexts.push(this);
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: "peaking",
      frequency: new FakeParam(),
      Q: new FakeParam(),
      gain: new FakeParam(),
    });
  }
  createWaveShaper() {
    return Object.assign(new FakeNode(), { curve: null });
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), {
      fftSize: 64,
      getFloatTimeDomainData: (data: Float32Array) => data.fill(probeSignal),
    });
  }
  createMediaElementSource(el: HTMLMediaElement) {
    this.sources.push(el);
    return new FakeNode();
  }
}

const media = <T extends HTMLMediaElement>(tag: "video" | "audio", cors = true): T => {
  const el = document.createElement(tag) as T;
  if (cors) el.crossOrigin = "anonymous";
  return el;
};

const rock = graphSpec(selectPreset(defaultEqState(), "builtin:rock"), false);

async function freshEngine() {
  vi.resetModules();
  const module = await import("./mediaEqEngine");
  return { engine: new module.MediaEqEngine(), available: module.videoEqAvailable };
}

const settle = () => vi.advanceTimersByTimeAsync(2_000);

beforeEach(() => {
  vi.useFakeTimers();
  contexts.length = 0;
  probeSignal = 0.2;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:tone", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MediaEqEngine", () => {
  it("leaves the video alone until the equalizer changes the sound", async () => {
    const { engine } = await freshEngine();
    engine.setElements([media("video"), null]);
    engine.setEq(rock, false);
    await settle();
    expect(contexts).toHaveLength(0);
  });

  it("routes the video and its separate audio once each, and follows a new audio element", async () => {
    const { engine } = await freshEngine();
    const video = media<HTMLVideoElement>("video");
    const audio = media<HTMLAudioElement>("audio");
    engine.setElements([video, audio]);
    engine.setEq(rock, true);
    await settle();

    const ctx = contexts[0]!;
    // The first source is the self-test's own element.
    expect(ctx.sources.slice(1)).toEqual([video, audio]);

    engine.setElements([video, audio]);
    engine.setEq(rock, true);
    await settle();
    expect(ctx.sources).toHaveLength(3);

    const nextAudio = media<HTMLAudioElement>("audio");
    engine.setElements([video, nextAudio]);
    await settle();
    expect(ctx.sources.slice(1)).toEqual([video, audio, nextAudio]);
  });

  it("falls back to plain playback when WebAudio returns silence", async () => {
    probeSignal = 0;
    const { engine, available } = await freshEngine();
    const video = media<HTMLVideoElement>("video");
    engine.setElements([video, null]);
    engine.setEq(rock, true);
    await settle();

    expect(contexts[0]!.sources).not.toContain(video);
    expect(available()).toBe(false);
  });

  it("tries the self-test again when the video plays, if it could not run before", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new Error("NotAllowedError"));
    const { engine, available } = await freshEngine();
    const video = media<HTMLVideoElement>("video");
    engine.setElements([video, null]);
    engine.setEq(rock, true);
    await settle();
    expect(contexts[0]!.sources).not.toContain(video);
    expect(available()).toBe(true);

    play.mockResolvedValue(undefined);
    video.dispatchEvent(new Event("play"));
    await settle();
    expect(contexts[0]!.sources).toContain(video);
  });

  it("never routes an element fetched without CORS, which would play silent", async () => {
    const { engine } = await freshEngine();
    const video = media<HTMLVideoElement>("video", false);
    engine.setElements([video, null]);
    engine.setEq(rock, true);
    await settle();
    expect(contexts[0]!.sources).not.toContain(video);
  });
});
