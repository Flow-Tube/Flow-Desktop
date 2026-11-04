import { describe, expect, it } from "vitest";

import { changed, nowOf, queueWindow, type Playing } from "./now";

const PLAYING: Playing = {
  video: "v2",
  title: "Title",
  by: "Channel",
  music: false,
  position: 12.5,
  duration: 300,
  playing: true,
  volume: 0.8,
  queue: ["v1", "v2", "v3"],
  index: 1,
};

describe("nowOf", () => {
  it("reports milliseconds, a 0 to 100 volume, and the queue around the video", () => {
    expect(nowOf(PLAYING)).toEqual({
      video: "v2",
      title: "Title",
      by: "Channel",
      music: false,
      link: null,
      pos: 12_500,
      dur: 300_000,
      state: "playing",
      vol: 80,
      queue: ["v1", "v2", "v3"],
      index: 1,
    });
  });

  it("says nothing is loaded", () => {
    expect(nowOf(null)).toMatchObject({ video: null, state: "paused", queue: [] });
  });
});

describe("queueWindow", () => {
  it("keeps 50 videos around the current one", () => {
    const queue = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const window = queueWindow(queue, 100);
    expect(window.queue).toHaveLength(50);
    expect(window.queue[window.index]).toBe("v100");
    expect(queueWindow(queue, 2).queue[queueWindow(queue, 2).index]).toBe("v2");
  });
});

describe("changed", () => {
  const sent = nowOf(PLAYING);
  it("ignores a position that moved on with time", () => {
    expect(changed(sent, 0, { ...sent, pos: sent.pos + 5000 }, 5000)).toBe(false);
  });
  it("sees a seek, a pause and a new video", () => {
    expect(changed(sent, 0, { ...sent, pos: 90_000 }, 1000)).toBe(true);
    expect(changed(sent, 0, { ...sent, state: "paused" }, 1000)).toBe(true);
    expect(changed(sent, 0, { ...sent, video: "v3", index: 2 }, 1000)).toBe(true);
  });
});
