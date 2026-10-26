import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVideoStream } from "./useVideoStream";
import { usePlayerStore } from "../store/usePlayerStore";
import { useDownloadsLibraryStore } from "../store/useDownloadsLibraryStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { getStreamInfo } from "./api/youtube";
import { clearStreamInfoCache } from "./streamResolution";

vi.mock("./api/youtube", () => ({ getStreamInfo: vi.fn() }));
vi.mock("./api/db", () => ({ addWatchRecord: vi.fn().mockResolvedValue(undefined) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); clearStreamInfoCache(); localStorage.clear(); });

it("keeps the resolved source and resume position when metadata enriches the same video", async () => {
  vi.stubGlobal("MediaSource", { isTypeSupported: (mime: string) => mime.includes("avc1") || mime.includes("mp4a") });
  useDownloadsLibraryStore.setState({ loaded: true, records: [] });
  useAppSettingsStore.setState({ values: {} });
  usePlayerStore.setState({ currentVideo: { id: "video", title: "", channelName: "" }, queue: [{ id: "video", title: "", channelName: "" }] });
  localStorage.setItem("flow_watch_progress:video", JSON.stringify({ currentTime: 25, duration: 300 }));
  vi.mocked(getStreamInfo).mockResolvedValue({
    streamId: "s", localUrl: "video", expiresAt: "", captions: [], dashManifestUrl: "manifest",
    variants: [{ id: "v", localUrl: "video", mimeType: 'video/mp4; codecs="avc1.4d401f"', qualityLabel: "720p", isPlayable: true, isDefault: true, hasAudio: false, isVideoOnly: true, deliveryMethod: "progressive" }],
    audioTracks: [{ id: "a", label: "Original", localUrl: "audio", mimeType: 'audio/mp4; codecs="mp4a.40.2"', isDefault: true, available: true }],
  });
  let latest!: ReturnType<typeof useVideoStream>;
  function Harness() { latest = useVideoStream("video"); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
    expect(latest.sourceMode).toBe("dash-native");
    expect(latest.resumeTime).toBe(25);
    await act(async () => usePlayerStore.getState().enrichCurrentVideo("video", { title: "Loaded", channelName: "Channel" }));
    expect(latest.dashManifestUrl).toBe("manifest");
    expect(latest.resumeTime).toBe(25);
    expect(latest.loadingStream).toBe(false);
    expect(getStreamInfo).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});

it("names the stream's video only once that video's source is set", async () => {
  vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
  useDownloadsLibraryStore.setState({ loaded: true, records: [] });
  useAppSettingsStore.setState({ values: {} });
  const info = {
    streamId: "s", localUrl: "video", expiresAt: "", captions: [], dashManifestUrl: "manifest",
    variants: [{ id: "v", localUrl: "video", mimeType: 'video/mp4; codecs="avc1.4d401f"', qualityLabel: "720p", isPlayable: true, isDefault: true, hasAudio: true, isVideoOnly: false, deliveryMethod: "progressive" }],
    audioTracks: [],
  };
  let answerNext!: (value: typeof info) => void;
  vi.mocked(getStreamInfo)
    .mockResolvedValueOnce(info)
    .mockReturnValueOnce(new Promise((resolve) => { answerNext = resolve; }) as never);
  usePlayerStore.setState({ currentVideo: { id: "first", title: "", channelName: "" } });
  let latest!: ReturnType<typeof useVideoStream>;
  function Harness() { latest = useVideoStream(usePlayerStore((s) => s.currentVideo?.id)); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(latest.streamVideoId).toBe("first");
    await act(async () => usePlayerStore.setState({ currentVideo: { id: "second", title: "", channelName: "" } }));
    expect(latest.streamVideoId).toBeNull();
    await act(async () => answerNext(info));
    expect(latest.streamVideoId).toBe("second");
  } finally { await act(async () => root.unmount()); }
});

describe("recovering a long video", () => {
  const info = {
    streamId: "s", localUrl: "video", expiresAt: "", captions: [], dashManifestUrl: "manifest",
    variants: [{ id: "v", localUrl: "video", mimeType: 'video/mp4; codecs="avc1.4d401f"', qualityLabel: "720p", isPlayable: true, isDefault: true, hasAudio: false, isVideoOnly: true, deliveryMethod: "progressive" }],
    audioTracks: [{ id: "a", label: "Original", localUrl: "audio", mimeType: 'audio/mp4; codecs="mp4a.40.2"', isDefault: true, available: true }],
  };

  async function mountAt(savedSeconds: number) {
    vi.stubGlobal("MediaSource", { isTypeSupported: (mime: string) => mime.includes("avc1") || mime.includes("mp4a") });
    useDownloadsLibraryStore.setState({ loaded: true, records: [] });
    useAppSettingsStore.setState({ values: {} });
    usePlayerStore.setState({ currentVideo: { id: "long", title: "", channelName: "", durationSeconds: 3600 }, currentTime: 0 });
    localStorage.setItem("flow_watch_progress:long", JSON.stringify({ currentTime: savedSeconds, duration: 3600 }));
    vi.mocked(getStreamInfo).mockReset().mockResolvedValue(info);
    const state = { latest: null as unknown as ReturnType<typeof useVideoStream> };
    function Harness() { state.latest = useVideoStream("long"); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    return { state, root };
  }

  it("hands the next source the saved position when the first never played", async () => {
    const { state, root } = await mountAt(2400);
    try {
      expect(state.latest.sourceMode).toBe("dash-native");
      expect(state.latest.resumeTime).toBe(2400);
      // A swap reset the element, and the store heard 0.
      usePlayerStore.setState({ currentTime: 0 });
      await act(async () => state.latest.onRetrySource("media-error"));
      expect(state.latest.sourceMode).toBe("direct");
      expect(state.latest.resumeTime).toBe(2400);
      expect(getStreamInfo).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });

  it("fetches fresh links and resumes where playback stopped", async () => {
    const { state, root } = await mountAt(2400);
    try {
      await act(async () => state.latest.notePlaybackTime(2450));
      usePlayerStore.setState({ currentTime: 0 });
      await act(async () => state.latest.onRetrySource("buffering-stall"));
      expect(getStreamInfo).toHaveBeenCalledTimes(2);
      expect(state.latest.resumeTime).toBe(2450);
      // The fresh source has not played yet, so a second failure keeps 2450.
      await act(async () => state.latest.onRetrySource("media-error"));
      expect(state.latest.resumeTime).toBe(2450);
    } finally { await act(async () => root.unmount()); }
  });
});

describe("fetching fresh links", () => {
  const info = {
    streamId: "s", localUrl: "video", expiresAt: "", captions: [], dashManifestUrl: "manifest",
    variants: [{ id: "v", localUrl: "video", mimeType: 'video/mp4; codecs="avc1.4d401f"', qualityLabel: "720p", isPlayable: true, isDefault: true, hasAudio: false, isVideoOnly: true, deliveryMethod: "progressive" }],
    audioTracks: [{ id: "a", label: "Original", localUrl: "audio", mimeType: 'audio/mp4; codecs="mp4a.40.2"', isDefault: true, available: true }],
  };

  async function mount() {
    vi.stubGlobal("MediaSource", { isTypeSupported: (mime: string) => mime.includes("avc1") || mime.includes("mp4a") });
    useDownloadsLibraryStore.setState({ loaded: true, records: [] });
    useAppSettingsStore.setState({ values: {} });
    usePlayerStore.setState({ currentVideo: { id: "first", title: "", channelName: "" } });
    vi.mocked(getStreamInfo).mockReset().mockResolvedValue(info);
    const state = { latest: null as unknown as ReturnType<typeof useVideoStream> };
    function Harness() { state.latest = useVideoStream(usePlayerStore((s) => s.currentVideo?.id)); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    return { state, root };
  }

  it("shows loading, and drops an answer that arrives after the video changed", async () => {
    const { state, root } = await mount();
    try {
      let answer!: (value: typeof info) => void;
      vi.mocked(getStreamInfo)
        .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }) as never)
        .mockReturnValueOnce(new Promise(() => {}) as never);
      await act(async () => state.latest.onHardRetry());
      expect(state.latest.loadingStream).toBe(true);
      await act(async () => usePlayerStore.setState({ currentVideo: { id: "second", title: "", channelName: "" } }));
      await act(async () => answer({ ...info, dashManifestUrl: "stale" }));
      expect(state.latest.dashManifestUrl).toBeNull();
      expect(state.latest.streamVideoId).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

  it("reports an error when the fresh links have no playable source", async () => {
    const { state, root } = await mount();
    try {
      vi.mocked(getStreamInfo).mockResolvedValueOnce({ ...info, dashManifestUrl: undefined, variants: [], audioTracks: [], localUrl: "" } as never);
      await act(async () => state.latest.onHardRetry());
      expect(state.latest.sourceMode).toBe("unavailable");
      expect(state.latest.streamErrorKind).toBe("streaming");
      expect(state.latest.loadingStream).toBe(false);
    } finally { await act(async () => root.unmount()); }
  });

  it("holds source fallback while the retry runs, and gives up after a minute", async () => {
    const { state, root } = await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.mocked(getStreamInfo).mockReturnValueOnce(new Promise(() => {}) as never);
      await act(async () => state.latest.onHardRetry());
      await act(async () => state.latest.onRetrySource("media-error:4"));
      expect(state.latest.sourceMode).toBe("dash-native");
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(state.latest.streamErrorKind).toBe("network");
      expect(state.latest.loadingStream).toBe(false);
    } finally {
      vi.useRealTimers();
      await act(async () => root.unmount());
    }
  });
});
