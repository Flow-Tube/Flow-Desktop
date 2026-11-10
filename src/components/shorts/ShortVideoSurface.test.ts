// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dashjs", () => ({ MediaPlayer: vi.fn() }));
vi.mock("../../lib/audio/useVideoEq", () => ({ useVideoEq: vi.fn() }));
vi.mock("../../lib/useSubtitleSettingsSync", () => ({ useSubtitleSettingsSync: vi.fn() }));

const { ShortVideoSurface } = await import("./ShortVideoSurface");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = {
  videoId: "s",
  dashUrl: null,
  videoUrl: "http://127.0.0.1/video",
  audioUrl: "http://127.0.0.1/english",
  audioTracks: [],
  selectedAudioTrackId: null,
  onSelectAudioTrack: () => {},
  onDoubleClickLike: () => {},
  qualities: [],
  captions: [],
  selectedQualityId: "auto",
  onSelectQuality: () => {},
  active: true,
  muted: false,
  volume: 1,
  playbackMode: "loop",
  autoScrollSeconds: 10,
} satisfies ComponentProps<typeof ShortVideoSurface>;

let host: HTMLElement;
let root: Root;
let paused: WeakMap<HTMLMediaElement, boolean>;
const load = vi.fn();
const play = vi.fn();

const render = (extra: Partial<Record<"videoUrl" | "audioUrl", string>>) =>
  act(async () => root.render(createElement(ShortVideoSurface, { ...props, ...extra })));
const video = () => host.querySelector("video")!;
const audio = () => host.querySelector("audio")!;

beforeEach(() => {
  paused = new WeakMap();
  load.mockReset();
  play.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, false);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
  });
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

async function startPlayingAt(seconds: number) {
  await render({});
  await act(async () => void video().dispatchEvent(new Event("canplay")));
  video().currentTime = seconds;
  load.mockClear();
  play.mockClear();
}

describe("changing the audio language of a Short", () => {
  it("swaps only the audio and keeps the position", async () => {
    await startPlayingAt(7);
    await render({ audioUrl: "http://127.0.0.1/spanish" });
    expect(audio().getAttribute("src")).toBe("http://127.0.0.1/spanish");
    expect(video().getAttribute("src")).toBe(props.videoUrl);
    expect(video().currentTime).toBe(7);
    expect(audio().currentTime).toBe(7);
    expect(load.mock.contexts).not.toContain(video());
    expect(play.mock.contexts).toContain(audio());
  });

  it("keeps a pause", async () => {
    await startPlayingAt(7);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" })));
    expect(video().paused).toBe(true);
    play.mockClear();
    await render({ audioUrl: "http://127.0.0.1/spanish" });
    expect(audio().currentTime).toBe(7);
    expect(play.mock.contexts).not.toContain(audio());
  });

  it("still loads both from the start when the video changes", async () => {
    await startPlayingAt(7);
    await render({ videoUrl: "http://127.0.0.1/other", audioUrl: "http://127.0.0.1/spanish" });
    expect(video().getAttribute("src")).toBe("http://127.0.0.1/other");
    expect(audio().getAttribute("src")).toBe("http://127.0.0.1/spanish");
    expect(load.mock.contexts).toContain(video());
  });
});
