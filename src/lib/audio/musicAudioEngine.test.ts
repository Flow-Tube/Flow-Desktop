import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { volumeGain } from "./volumeCurve";
import { musicAudioEngine } from "./musicAudioEngine";

const elements = (): [HTMLAudioElement, HTMLAudioElement] => {
  const pair = [document.createElement("audio"), document.createElement("audio")] as [
    HTMLAudioElement,
    HTMLAudioElement,
  ];
  // jsdom implements no media loading or playback.
  for (const el of pair) {
    el.load = vi.fn();
    el.pause = vi.fn();
  }
  return pair;
};

let pair: [HTMLAudioElement, HTMLAudioElement];

const bufferedEnough = (el: HTMLAudioElement) =>
  Object.defineProperty(el, "readyState", { value: HTMLMediaElement.HAVE_FUTURE_DATA, configurable: true });

beforeEach(() => {
  pair = elements();
  musicAudioEngine.attach(pair);
});

describe("gapless standby element", () => {
  it("buffers the next track on the element that is not playing", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/current", null);
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", -4, null);

    expect(musicAudioEngine.getActiveElement()).toBe(pair[0]);
    expect(pair[1].getAttribute("src")).toBe("http://127.0.0.1/stream/next");
    expect(musicAudioEngine.hasPreloaded("next")).toBe(true);
    expect(musicAudioEngine.hasPreloaded("other")).toBe(false);
  });

  it("swaps only for the track it holds, and empties the one that played", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/current", null);
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", -4, null);
    bufferedEnough(pair[1]);

    expect(musicAudioEngine.activatePreloaded("other")).toBe(false);
    expect(musicAudioEngine.getActiveElement()).toBe(pair[0]);

    expect(musicAudioEngine.activatePreloaded("next")).toBe(true);
    expect(musicAudioEngine.getActiveElement()).toBe(pair[1]);
    expect(musicAudioEngine.getActiveLoudness()).toBe(-4);
    expect(pair[0].getAttribute("src")).toBeNull();
    expect(musicAudioEngine.hasPreloaded("next")).toBe(false);
  });

  it("never swaps in a preload that has no audio to play yet", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/current", null);
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", null, null);

    expect(musicAudioEngine.activatePreloaded("next")).toBe(false);
    expect(musicAudioEngine.getActiveElement()).toBe(pair[0]);
  });

  it("reports and drops what the standby element held", () => {
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", null, null);
    expect(musicAudioEngine.clearPreload()).toBe("next");
    expect(pair[1].getAttribute("src")).toBeNull();
    expect(musicAudioEngine.clearPreload()).toBeNull();
  });
});

describe("music speed", () => {
  // Counts writes: on WebKitGTK every playbackRate write flushes the audio pipeline.
  const countRateWrites = (el: HTMLAudioElement) => {
    let rate = 1;
    const writes = { count: 0 };
    Object.defineProperty(el, "playbackRate", {
      configurable: true,
      get: () => rate,
      set: (value: number) => {
        writes.count++;
        rate = value;
      },
    });
    return writes;
  };

  it("writes the rate only when it changes, and carries it across loads", () => {
    const fresh = elements();
    const writes = countRateWrites(fresh[0]);
    musicAudioEngine.attach(fresh);
    musicAudioEngine.setSpeed(1);
    expect(writes.count).toBe(0);

    musicAudioEngine.setSpeed(1.5);
    musicAudioEngine.setSpeed(1.5);
    expect(writes.count).toBe(1);
    expect(fresh[0].defaultPlaybackRate).toBe(1.5);
    expect(fresh[0].preservesPitch).toBe(true);

    musicAudioEngine.setSpeed(9);
    expect(fresh[0].playbackRate).toBe(2);
    musicAudioEngine.setSpeed(1);
  });
});

describe("sleep timer fade-out", () => {
  it("steps the element volume down without WebAudio, and puts it back after", () => {
    musicAudioEngine.setVolume(0.8);
    musicAudioEngine.fadeOut(0.5, 10);
    expect(pair[0].volume).toBeCloseTo(volumeGain(0.8) * 0.5);

    musicAudioEngine.setVolume(1);
    expect(pair[0].volume).toBeCloseTo(0.5);

    musicAudioEngine.resetFade();
    expect(pair[0].volume).toBeCloseTo(1);
  });
});

describe("a song WebKit reports at twice its length", () => {
  const reports = (el: HTMLAudioElement, duration: number, currentTime: number) => {
    Object.defineProperty(el, "duration", { value: duration, configurable: true });
    Object.defineProperty(el, "currentTime", { value: currentTime, configurable: true, writable: true });
  };

  it("plays for its listed length and ends there once", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/aac", 'audio/mp4; codecs="mp4a.40.2"', 245.269);
    reports(pair[0], 490.5, 120);
    expect(musicAudioEngine.getDuration()).toBe(245.269);
    expect(musicAudioEngine.takeListedEnd()).toBe(false);

    reports(pair[0], 490.5, 245.4);
    expect(musicAudioEngine.takeListedEnd()).toBe(true);
    expect(pair[0].pause).toHaveBeenCalled();
    expect(musicAudioEngine.takeListedEnd()).toBe(false);

    // Repeat one seeks back, and the song can end again.
    musicAudioEngine.seek(0);
    reports(pair[0], 490.5, 245.4);
    expect(musicAudioEngine.takeListedEnd()).toBe(true);
  });

  it("carries the next song's listed length through the gapless swap", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/current", null, 200);
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", null, null, 180);
    bufferedEnough(pair[1]);
    musicAudioEngine.activatePreloaded("next");
    reports(pair[1], 360, 0);
    expect(musicAudioEngine.getDuration()).toBe(180);
  });

  it("leaves a correctly reported song to its own end", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/opus", 'audio/webm; codecs="opus"', 245.281);
    reports(pair[0], 245.3, 245.29);
    expect(musicAudioEngine.getDuration()).toBe(245.3);
    expect(musicAudioEngine.takeListedEnd()).toBe(false);
  });
});

describe("crossfade without a buffered next song", () => {
  const playing = (el: HTMLAudioElement) => Object.defineProperty(el, "paused", { value: false, configurable: true });

  beforeEach(() => {
    vi.useFakeTimers();
    musicAudioEngine.setVolume(1);
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the song a skip leaves playing until the next one starts, then fades the two", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    playing(pair[0]);

    musicAudioEngine.holdForSkip(1);
    await musicAudioEngine.load("http://127.0.0.1/stream/b", null);
    expect(musicAudioEngine.getActiveElement()).toBe(pair[1]);
    expect(pair[0].getAttribute("src")).toBe("http://127.0.0.1/stream/a");
    expect(pair[1].volume).toBe(0);

    // A second skip before the next song plays only changes what loads.
    musicAudioEngine.holdForSkip(1);
    expect(musicAudioEngine.clearPreload()).toBeNull();
    expect(pair[0].getAttribute("src")).toBe("http://127.0.0.1/stream/a");

    pair[1].dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(500);
    expect(pair[0].volume).toBeGreaterThan(0);
    expect(pair[0].volume).toBeLessThan(1);
    expect(pair[1].volume).toBeGreaterThan(0);

    vi.advanceTimersByTime(600);
    expect(pair[0].getAttribute("src")).toBeNull();
    expect(pair[1].volume).toBeCloseTo(1);
  });

  it("lets the old song go when playback pauses, or the next song never starts", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    playing(pair[0]);
    musicAudioEngine.holdForSkip(1);
    musicAudioEngine.pause();
    expect(pair[0].getAttribute("src")).toBeNull();
    expect(pair[1].volume).toBeCloseTo(1);

    await musicAudioEngine.load("http://127.0.0.1/stream/b", null);
    playing(pair[1]);
    musicAudioEngine.holdForSkip(1);
    vi.advanceTimersByTime(10_000);
    expect(pair[1].getAttribute("src")).toBeNull();
    expect(pair[0].volume).toBeCloseTo(1);
  });

  it("fades the song out on its own, and brings the next one in quickly", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    musicAudioEngine.fadeThrough(2);
    expect(musicAudioEngine.isFadingThrough()).toBe(true);
    vi.advanceTimersByTime(2_100);
    expect(pair[0].volume).toBeCloseTo(0);

    await musicAudioEngine.load("http://127.0.0.1/stream/b", null);
    expect(musicAudioEngine.isFadingThrough()).toBe(false);
    expect(pair[0].volume).toBe(0);
    pair[0].dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(200);
    expect(pair[0].volume).toBeGreaterThan(0);
    expect(pair[0].volume).toBeLessThan(1);
    vi.advanceTimersByTime(300);
    expect(pair[0].volume).toBeCloseTo(1);
  });

  it("puts a song fading on its own back to full on a seek", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/a", null);
    musicAudioEngine.fadeThrough(2);
    vi.advanceTimersByTime(1_000);
    musicAudioEngine.seek(30);
    expect(pair[0].volume).toBeCloseTo(1);

    await musicAudioEngine.load("http://127.0.0.1/stream/b", null);
    expect(pair[0].volume).toBeCloseTo(1);
  });
});
