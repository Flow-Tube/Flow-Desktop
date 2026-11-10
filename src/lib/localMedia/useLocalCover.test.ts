import { beforeEach, describe, expect, it, vi } from "vitest";

const getLocalCover = vi.fn();
const getLocalStream = vi.fn();
const saveLocalFrame = vi.fn();
vi.mock("../api/localMedia", () => ({
  getLocalCover: (id: string) => getLocalCover(id),
  getLocalStream: (id: string) => getLocalStream(id),
  saveLocalFrame: (id: string, frame: string) => saveLocalFrame(id, frame),
}));
const grabVideoFrame = vi.fn();
vi.mock("./videoFrame", () => ({ grabVideoFrame: (url: string) => grabVideoFrame(url) }));

const { coverOf } = await import("./useLocalCover");

const stream = { url: "http://127.0.0.1:1/stream/t", videoCodec: "", audioCodec: "" };

describe("coverOf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLocalStream.mockResolvedValue(stream);
  });

  it("uses the file's own picture without touching the video", async () => {
    getLocalCover.mockResolvedValue("cover-url");
    await expect(coverOf("own", true)).resolves.toBe("cover-url");
    expect(grabVideoFrame).not.toHaveBeenCalled();
  });

  it("takes a frame once from a video with no picture, and keeps it", async () => {
    getLocalCover.mockResolvedValue(null);
    grabVideoFrame.mockResolvedValue("base64");
    saveLocalFrame.mockResolvedValue("frame-url");
    await expect(coverOf("bare", true)).resolves.toBe("frame-url");
    await expect(coverOf("bare", true)).resolves.toBe("frame-url");
    expect(grabVideoFrame).toHaveBeenCalledTimes(1);
    expect(saveLocalFrame).toHaveBeenCalledWith("bare", "base64");
  });

  it("leaves a song without a picture alone", async () => {
    getLocalCover.mockResolvedValue(null);
    await expect(coverOf("song", false)).resolves.toBeNull();
    expect(getLocalStream).not.toHaveBeenCalled();
  });

  it("stays blank for a video the webview can't decode", async () => {
    getLocalCover.mockResolvedValue(null);
    grabVideoFrame.mockResolvedValue(null);
    await expect(coverOf("undecodable", true)).resolves.toBeNull();
    expect(saveLocalFrame).not.toHaveBeenCalled();
  });

  it("stays blank when asking fails", async () => {
    getLocalCover.mockRejectedValue(new Error("gone"));
    await expect(coverOf("failed", true)).resolves.toBeNull();
  });
});
