import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../types/music";
import { MusicListenTracker } from "./musicListenTracker";

const song = (id: string) => ({ id, videoId: id, duration: 200 }) as SongItem;
const a = song("a");
const b = song("b");

const recordListen = vi.fn();
const recordPosition = vi.fn();
let tracker: MusicListenTracker;

/** Plays `track` for `seconds` of wall clock from `start`, ticking like timeupdate (4 Hz). */
const play = (track: SongItem, start: number, seconds: number, position = (t: number) => t / 1000) => {
  for (let t = 0; t <= seconds * 1000; t += 250) tracker.tick(track, position(t), 200, start + t);
};

beforeEach(() => {
  recordListen.mockClear();
  recordPosition.mockClear();
  tracker = new MusicListenTracker({ recordListen, recordPosition });
});

describe("listen accounting", () => {
  it("counts the time a song played, not where the playhead went", () => {
    // A drag to the end after two seconds is two seconds of listening.
    play(a, 0, 2, (t) => (t >= 1000 ? 199 : 0));
    tracker.switchTo(b, 2_000);
    expect(recordListen).toHaveBeenLastCalledWith(a, 2, 200);
  });

  it("writes no row for a song that never played", () => {
    tracker.switchTo(a, 0);
    tracker.switchTo(b, 1_000);
    expect(recordListen).not.toHaveBeenCalled();
    expect(recordPosition).not.toHaveBeenCalled();
  });

  it("leaves pauses and buffering out", () => {
    play(a, 0, 3);
    tracker.pause();
    play(a, 60_000, 2);
    tracker.hold();
    play(a, 120_000, 1);
    tracker.switchTo(null, 130_000);
    expect(recordListen).toHaveBeenLastCalledWith(a, 6, 200);
  });

  it("drops a gap no song could have filled, such as a sleeping machine", () => {
    tracker.tick(a, 0, 200, 0);
    tracker.tick(a, 1, 200, 1_000);
    tracker.tick(a, 2, 200, 3_600_000);
    expect(tracker.listenedSeconds()).toBe(1);
  });

  it("credits a gapless swap to the song that played", () => {
    play(a, 0, 4);
    // The new song's first tick arrives before the player says it moved on.
    tracker.tick(b, 0, 200, 4_250);
    tracker.switchTo(b, 4_300);
    expect(recordListen).toHaveBeenCalledWith(a, 4, 200);
    expect(recordListen).not.toHaveBeenCalledWith(b, expect.anything(), expect.anything());
  });

  it("counts a repeat of the same song as a new listen", () => {
    play(a, 0, 3);
    tracker.finish(3_000);
    expect(recordListen).toHaveBeenLastCalledWith(a, 3, 200);
    expect(recordPosition).toHaveBeenLastCalledWith(a, 200, 200);
    play(a, 4_000, 1);
    expect(tracker.listenedSeconds()).toBe(1);
  });

  it("saves the listen as it goes, so a crash loses little", () => {
    play(a, 0, 6);
    expect(recordListen).toHaveBeenCalledWith(a, 5, 200);
  });

  it("remembers where a paused song was left", () => {
    play(a, 0, 2, () => 120);
    tracker.pause();
    expect(recordPosition).toHaveBeenLastCalledWith(a, 120, 200);
  });
});
