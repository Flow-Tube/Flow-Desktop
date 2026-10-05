import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/usePlayerStore";
import { useWatchVideoDetails } from "./useWatchVideoDetails";
import { getVideoDetails } from "./api/youtube";

vi.mock("./api/youtube", () => ({ getVideoDetails: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReturnType<typeof useWatchVideoDetails>;
function Harness({ enabled, videoId = "video" }: { enabled: boolean; videoId?: string }) {
  latest = useWatchVideoDetails(videoId, enabled, 0);
  return null;
}

beforeEach(() => {
  vi.mocked(getVideoDetails).mockReset();
  usePlayerStore.getState().clearQueue();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe("watch metadata priority", () => {
  it("waits for playback and shares StrictMode requests", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(getVideoDetails).mockImplementation(() => new Promise((done) => { resolve = done; }));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { enabled: false }))));
    expect(getVideoDetails).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { enabled: true }))));
    expect(getVideoDetails).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ id: "video", title: "Loaded", channelName: "Channel" }));
    expect(latest?.title).toBe("Loaded");
  });

  it("keeps a cold-open queue when optional metadata fails", async () => {
    usePlayerStore.setState({ currentVideo: { id: "video", title: "", channelName: "" }, queue: [{ id: "video", title: "", channelName: "" }] });
    vi.mocked(getVideoDetails).mockRejectedValue({ kind: "botCheckRequired" });
    await act(async () => root.render(createElement(Harness, { enabled: true })));
    expect(usePlayerStore.getState().currentVideo?.id).toBe("video");
    expect(latest).toBeNull();
  });

  it("ignores a late response after switching videos", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(getVideoDetails).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => root.render(createElement(Harness, { enabled: true })));
    await act(async () => root.render(createElement(Harness, { enabled: false, videoId: "next" })));
    await act(async () => resolve({ id: "video", title: "Old", channelName: "Channel" }));
    expect(latest).toBeNull();
    expect(usePlayerStore.getState().watchPageCache).toBeNull();
  });
});
