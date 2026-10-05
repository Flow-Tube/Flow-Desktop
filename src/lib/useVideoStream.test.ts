import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
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
