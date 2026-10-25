import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { parseSavedQueue, serializeQueue, type QueueSnapshot } from "./musicQueuePersistence";

const track = (id: string, seconds: number | null = 200): SongItem => ({
  id,
  title: id,
  artists: [],
  album: null,
  duration: seconds,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const snapshot = (overrides: Partial<QueueSnapshot> = {}): QueueSnapshot => ({
  queue: [track("a"), track("b"), track("c")],
  currentIndex: 1,
  progress: 61,
  queueSource: "Quick picks",
  unshuffledQueue: null,
  radioQueuedIds: [],
  radioStationActive: false,
  ...overrides,
});

const roundTrip = (overrides: Partial<QueueSnapshot> = {}) =>
  parseSavedQueue(JSON.stringify(serializeQueue(snapshot(overrides))));

// Cases ported from Android's RestoredMusicQueueTest.
describe("restoring the saved queue", () => {
  it("resumes the saved song where it stopped", () => {
    const restored = roundTrip()!;
    expect(restored.queue[restored.currentIndex]?.id).toBe("b");
    expect(restored.currentIndex).toBe(1);
    expect(restored.resumeAt).toBe(61);
    expect(restored.queueSource).toBe("Quick picks");
  });

  it("lets the song id win over a stale index", () => {
    const saved = { ...serializeQueue(snapshot()), currentIndex: 0, currentTrackId: "c" };
    expect(parseSavedQueue(JSON.stringify(saved))!.currentIndex).toBe(2);
  });

  it("starts a song stopped in its last five seconds over", () => {
    expect(roundTrip({ progress: 197 })!.resumeAt).toBe(0);
    expect(roundTrip({ progress: 194 })!.resumeAt).toBe(194);
  });

  it("still resumes a song of unknown length", () => {
    expect(roundTrip({ queue: [track("a", 0)], currentIndex: 0 })!.resumeAt).toBe(61);
    expect(roundTrip({ queue: [track("a", null)], currentIndex: 0 })!.resumeAt).toBe(61);
  });

  it("clamps an index past the end, and restores nothing from an empty or broken save", () => {
    const saved = { ...serializeQueue(snapshot()), currentIndex: 9, currentTrackId: null };
    expect(parseSavedQueue(JSON.stringify(saved))!.currentIndex).toBe(2);
    expect(roundTrip({ queue: [], currentIndex: -1 })).toBeNull();
    expect(parseSavedQueue("not json")).toBeNull();
    expect(parseSavedQueue(null)).toBeNull();
    expect(parseSavedQueue(JSON.stringify({ version: 2, queue: [] }))).toBeNull();
  });

  it("brings back the order shuffle restores, and the station's songs", () => {
    const [a, b, c] = [track("a"), track("b"), track("c")];
    const restored = roundTrip({
      queue: [b, c, a],
      currentIndex: 0,
      unshuffledQueue: [a, b, c],
      radioQueuedIds: ["c"],
      radioStationActive: true,
    })!;
    expect(restored.unshuffledQueue?.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(restored.unshuffledQueue?.[0]).toBe(restored.queue[2]);
    expect(restored.radioQueuedIds).toEqual(["c"]);
    expect(restored.radioStationActive).toBe(true);
  });
});
