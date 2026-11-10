import { describe, expect, it } from "vitest";
import { queueWithNext } from "./videoQueueEdits";
import type { VideoSummary } from "../types/video";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "" });
const ids = (queue: VideoSummary[]) => queue.map((item) => item.id);
const queue = ["a", "b", "c", "d"].map(video);

describe("queueWithNext", () => {
  it("inserts a new video right after the current one", () => {
    const next = queueWithNext(queue, 1, video("x"));
    expect(ids(next.queue)).toEqual(["a", "b", "x", "c", "d"]);
    expect(next.currentIndex).toBe(1);
  });

  it("moves one queued later", () => {
    expect(ids(queueWithNext(queue, 0, video("d")).queue)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves one queued earlier and keeps the current video current", () => {
    const next = queueWithNext(queue, 2, video("a"));
    expect(ids(next.queue)).toEqual(["b", "c", "a", "d"]);
    expect(next.queue[next.currentIndex]?.id).toBe("c");
  });
});
