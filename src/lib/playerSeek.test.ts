import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seekWhenVideoReady } from "./playerSeek";

function videoWithDuration(duration: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { value: duration });
  return video;
}

describe("seekWhenVideoReady", () => {
  const seeks: number[] = [];
  const onSeek = (event: Event) => seeks.push((event as CustomEvent<{ time: number }>).detail.time);

  beforeEach(() => {
    vi.useFakeTimers();
    seeks.length = 0;
    window.addEventListener("flow-player-seek", onSeek);
  });

  afterEach(() => {
    window.removeEventListener("flow-player-seek", onSeek);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("waits for the watch player, not a card's video earlier on the page", () => {
    document.body.append(videoWithDuration(30));
    seekWhenVideoReady(42);
    vi.advanceTimersByTime(1500);
    expect(seeks).toEqual([]);

    const content = document.createElement("div");
    content.setAttribute("data-player-content", "");
    content.append(videoWithDuration(600));
    document.body.append(content);
    vi.advanceTimersByTime(400);
    expect(seeks).toEqual([42]);
  });
});
