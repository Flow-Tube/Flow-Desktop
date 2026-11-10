import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecapListenEvent } from "../api/recap";
import type { SongItem } from "../../types/music";

const events: RecapListenEvent[] = [];
vi.mock("./recapQueue", () => ({ recapListen: (event: RecapListenEvent) => events.push(event) }));

const { RecapMusicSession, recapLikedSong } = await import("./musicSession");

const song = (id: string) =>
  ({ id, videoId: id, title: `${id} title`, artists: [{ id: "UCa", name: "Artist" }], thumbnail: "art" }) as unknown as SongItem;

describe("RecapMusicSession", () => {
  beforeEach(() => {
    events.length = 0;
  });

  it("sends only the new seconds of a running total, and one session", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 5, 200);
    session.note(song("a"), 10, 200);
    session.note(song("a"), 10, 200);
    expect(events.map((e) => e.listenedMs)).toEqual([5000, 5000]);
    expect(events.map((e) => e.continued)).toEqual([false, true]);
  });

  it("sends whole milliseconds from a fractional running total", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 5.0005, 300);
    expect(Number.isInteger(events[0]!.listenedMs)).toBe(true);
  });

  it("counts one play when the listen passes half the song", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 60, 200);
    session.note(song("a"), 100, 200);
    session.note(song("a"), 150, 200);
    expect(events.filter((e) => e.counted)).toHaveLength(1);
    expect(events[1]!.counted).toBe(true);
  });

  it("names a song left early as skipped when the next one starts", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 10, 200);
    session.note(song("b"), 1, 200);
    const skipped = events.filter((e) => e.skipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.trackId).toBe("a");
    expect(skipped[0]!.listenedMs).toBe(0);
  });

  it("calls neither a mis-tap nor a song past the first milestone a skip", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 3, 200);
    session.note(song("b"), 40, 200);
    session.note(song("c"), 1, 200);
    expect(events.some((e) => e.skipped)).toBe(false);
  });

  it("treats a total that falls as a replay: a new session that can count again", () => {
    const session = new RecapMusicSession();
    session.note(song("a"), 150, 200);
    session.note(song("a"), 120, 200);
    expect(events.filter((e) => e.counted)).toHaveLength(2);
    expect(events[1]!.continued).toBe(false);
  });

  it("counts a liked song as a play with no time", () => {
    recapLikedSong(song("a"));
    expect(events[0]).toMatchObject({ trackId: "a", counted: true, listenedMs: 0, continued: false });
  });
});
