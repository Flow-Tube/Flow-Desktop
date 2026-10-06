import { beforeEach, describe, expect, it, vi } from "vitest";

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
    await musicAudioEngine.load("http://127.0.0.1/stream/current");
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", -4);

    expect(musicAudioEngine.getActiveElement()).toBe(pair[0]);
    expect(pair[1].getAttribute("src")).toBe("http://127.0.0.1/stream/next");
    expect(musicAudioEngine.hasPreloaded("next")).toBe(true);
    expect(musicAudioEngine.hasPreloaded("other")).toBe(false);
  });

  it("swaps only for the track it holds, and empties the one that played", async () => {
    await musicAudioEngine.load("http://127.0.0.1/stream/current");
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", -4);
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
    await musicAudioEngine.load("http://127.0.0.1/stream/current");
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", null);

    expect(musicAudioEngine.activatePreloaded("next")).toBe(false);
    expect(musicAudioEngine.getActiveElement()).toBe(pair[0]);
  });

  it("reports and drops what the standby element held", () => {
    musicAudioEngine.preload("next", "http://127.0.0.1/stream/next", null);
    expect(musicAudioEngine.clearPreload()).toBe("next");
    expect(pair[1].getAttribute("src")).toBeNull();
    expect(musicAudioEngine.clearPreload()).toBeNull();
  });
});
