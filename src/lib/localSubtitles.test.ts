// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeBackend = vi.fn();
vi.mock("./api/errors", () => ({ invokeBackend: (...args: unknown[]) => invokeBackend(...args) }));

const { addSubtitleFile, fileNameOf, isSubtitlePath } = await import("./localSubtitles");
const { fetchCaptionText } = await import("./captionText");
const { useLocalSubtitleStore, videoSubtitleState, MAX_SUBTITLE_OFFSET_MS } = await import("../store/useLocalSubtitleStore");
const { useUiStore } = await import("../store/useUiStore");

const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello\n";

beforeEach(() => {
  invokeBackend.mockReset();
  window.localStorage.clear();
  useLocalSubtitleStore.setState({ videos: {} });
});

describe("local subtitle files", () => {
  it("reads only cues from a file that has them", async () => {
    invokeBackend.mockResolvedValue(SRT);
    expect(await addSubtitleFile("v", "/m/Film.en.srt")).toBe(true);
    expect(videoSubtitleState(useLocalSubtitleStore.getState().videos, "v").files).toEqual([
      { name: "Film.en.srt", path: "/m/Film.en.srt" },
    ]);
  });

  it("refuses a file with no cues or that can't be read, with a message", async () => {
    const showToast = vi.spyOn(useUiStore.getState(), "showToast");
    invokeBackend.mockResolvedValueOnce("no timings here");
    expect(await addSubtitleFile("v", "/m/a.srt")).toBe(false);
    invokeBackend.mockRejectedValueOnce(new Error("gone"));
    expect(await addSubtitleFile("v", "/m/b.srt")).toBe(false);
    expect(videoSubtitleState(useLocalSubtitleStore.getState().videos, "v").files).toEqual([]);
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it("fetches each kind of track its own way", async () => {
    invokeBackend.mockResolvedValue("x");
    await fetchCaptionText({ url: "local-subtitle:/m/a.srt" });
    expect(invokeBackend).toHaveBeenLastCalledWith("read_subtitle_file", { path: "/m/a.srt" });
    await fetchCaptionText({ url: "http://127.0.0.1/stream/t" });
    expect(invokeBackend).toHaveBeenLastCalledWith("fetch_subtitles", { url: "http://127.0.0.1/stream/t" });
  });

  it("recognises subtitle paths on any platform", () => {
    expect(isSubtitlePath("C:\\Films\\A.SRT")).toBe(true);
    expect(isSubtitlePath("/a/b.vtt")).toBe(true);
    expect(isSubtitlePath("/a/b.mp4")).toBe(false);
    expect(fileNameOf("C:\\Films\\A.srt")).toBe("A.srt");
  });

  it("keeps offsets per video, within the limit, and saved", () => {
    const store = useLocalSubtitleStore.getState();
    store.setOffset("v", 1500);
    store.setOffset("w", MAX_SUBTITLE_OFFSET_MS * 2);
    const { videos } = useLocalSubtitleStore.getState();
    expect(videoSubtitleState(videos, "v").offsetMs).toBe(1500);
    expect(videoSubtitleState(videos, "w").offsetMs).toBe(MAX_SUBTITLE_OFFSET_MS);
    expect(videoSubtitleState(videos, "other").offsetMs).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(Object.keys(window.localStorage)[0]!)!).v.offsetMs).toBe(1500);
  });

  it("forgets a video with nothing left to remember", () => {
    const store = useLocalSubtitleStore.getState();
    store.addFile("v", { name: "a.srt", path: "/a.srt" });
    store.removeFile("v", "/a.srt");
    expect(useLocalSubtitleStore.getState().videos).toEqual({});
  });
});
