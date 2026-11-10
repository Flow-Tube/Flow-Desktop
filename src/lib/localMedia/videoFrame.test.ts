import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { grabVideoFrame } from "./videoFrame";

class FakeVideo {
  crossOrigin = "";
  muted = false;
  preload = "";
  duration = 200;
  videoWidth = 1920;
  videoHeight = 1080;
  seekedTo: number | null = null;
  removed = false;
  onloadedmetadata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set currentTime(seconds: number) {
    this.seekedTo = seconds;
    queueMicrotask(() => this.onseeked?.());
  }
  set src(_url: string) {
    queueMicrotask(() => (failing ? this.onerror?.() : this.onloadedmetadata?.()));
  }
  removeAttribute() {
    this.removed = true;
  }
  load() {}
}

let failing = false;
let videos: FakeVideo[] = [];
let stillOpenWhenCreated: number[] = [];
const drawImage = vi.fn();
const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({ drawImage }),
  toDataURL: () => "data:image/jpeg;base64,QUJD",
};

describe("grabVideoFrame", () => {
  beforeEach(() => {
    failing = false;
    videos = [];
    stillOpenWhenCreated = [];
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "canvas") return canvas;
      stillOpenWhenCreated.push(videos.filter((known) => !known.removed).length);
      const video = new FakeVideo();
      videos.push(video);
      return video;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeks past the start, draws at card size and lets go of the file", async () => {
    await expect(grabVideoFrame("url")).resolves.toBe("QUJD");
    expect(videos[0]!.crossOrigin).toBe("anonymous");
    expect(videos[0]!.seekedTo).toBe(20);
    expect([canvas.width, canvas.height]).toEqual([640, 360]);
    expect(videos[0]!.removed).toBe(true);
  });

  it("doesn't seek a long film far in", async () => {
    const pending = grabVideoFrame("url");
    await Promise.resolve();
    videos[0]!.duration = 7200;
    await pending;
    expect(videos[0]!.seekedTo).toBe(60);
  });

  it("answers null for a file the webview can't read", async () => {
    failing = true;
    await expect(grabVideoFrame("url")).resolves.toBeNull();
    expect(videos[0]!.removed).toBe(true);
  });

  it("answers null when the canvas refuses", async () => {
    canvas.toDataURL = () => {
      throw new Error("tainted");
    };
    await expect(grabVideoFrame("url")).resolves.toBeNull();
    canvas.toDataURL = () => "data:image/jpeg;base64,QUJD";
  });

  it("takes frames one at a time", async () => {
    await Promise.all([grabVideoFrame("a"), grabVideoFrame("b")]);
    expect(videos.length).toBe(2);
    expect(stillOpenWhenCreated).toEqual([0, 0]);
  });
});
