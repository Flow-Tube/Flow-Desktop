import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreviewPosition, continueFromPreview, notePreviewPosition } from "./inlinePreviewHandoff";

describe("continueFromPreview", () => {
  const seeks: number[] = [];
  const onSeek = (event: Event) => seeks.push((event as CustomEvent<{ time: number }>).detail.time);

  beforeEach(() => {
    vi.useFakeTimers();
    seeks.length = 0;
    window.addEventListener("flow-player-seek", onSeek);
    const content = document.createElement("div");
    content.setAttribute("data-player-content", "");
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 300 });
    content.append(video);
    document.body.append(content);
  });

  afterEach(() => {
    window.removeEventListener("flow-player-seek", onSeek);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("opens the video at the second its card preview reached", () => {
    notePreviewPosition("vid1", 42.5);
    continueFromPreview("vid1");
    vi.advanceTimersByTime(500);
    expect(seeks).toEqual([42.5]);
  });

  it("starts as usual for another video, a cleared preview, or one barely started", () => {
    notePreviewPosition("vid1", 42);
    continueFromPreview("vid2");
    notePreviewPosition("vid1", 42);
    clearPreviewPosition("vid1");
    continueFromPreview("vid1");
    notePreviewPosition("vid1", 0.6);
    continueFromPreview("vid1");
    vi.advanceTimersByTime(2000);
    expect(seeks).toEqual([]);
  });
});
