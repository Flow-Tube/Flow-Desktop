import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { appendTracks, insertNext, isUpcoming, removeAt, removeWhere, type QueueLists } from "./musicQueueEdits";

const song = (id: string) => ({ id, videoId: id }) as SongItem;
const ids = (tracks: SongItem[] | null) => tracks?.map((t) => t.id) ?? null;
const [a, b, c, d] = ["a", "b", "c", "d"].map(song) as [SongItem, SongItem, SongItem, SongItem];

// Shuffled play order c, a, d, b from the original a, b, c, d, playing "a".
const shuffled: QueueLists = { queue: [c, a, d, b], unshuffledQueue: [a, b, c, d], currentIndex: 1 };
const plain: QueueLists = { queue: [a, b, c, d], unshuffledQueue: null, currentIndex: 1 };

describe("isUpcoming", () => {
  it("counts only songs still to play, so a played one can be queued again", () => {
    expect(isUpcoming(plain, a)).toBe(false);
    expect(isUpcoming(plain, b)).toBe(false);
    expect(isUpcoming(plain, c)).toBe(true);
  });
});

describe("queue edits keep the unshuffled order in step", () => {
  it("appends to both orders", () => {
    const e = song("e");
    const out = appendTracks(shuffled, [e]);
    expect(ids(out.queue)).toEqual(["c", "a", "d", "b", "e"]);
    expect(ids(out.unshuffledQueue)).toEqual(["a", "b", "c", "d", "e"]);
    expect(appendTracks(plain, [e]).unshuffledQueue).toBeNull();
  });

  it("plays a song next in both orders, moving it if it was already waiting", () => {
    const out = insertNext(shuffled, b);
    expect(ids(out.queue)).toEqual(["c", "a", "b", "d"]);
    expect(ids(out.unshuffledQueue)).toEqual(["a", "b", "c", "d"]);
    expect(out.currentIndex).toBe(1);

    const fresh = song("e");
    const withNew = insertNext(shuffled, fresh);
    expect(ids(withNew.queue)).toEqual(["c", "a", "e", "d", "b"]);
    expect(ids(withNew.unshuffledQueue)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("removes the same entry from both and keeps the current index on the playing song", () => {
    const out = removeAt(shuffled, 0);
    expect(ids(out.queue)).toEqual(["a", "d", "b"]);
    expect(ids(out.unshuffledQueue)).toEqual(["a", "b", "d"]);
    expect(out.currentIndex).toBe(0);
  });

  it("prunes hidden songs from both but never the one playing", () => {
    const out = removeWhere(shuffled, (t) => t === a || t === d);
    expect(ids(out.queue)).toEqual(["c", "a", "b"]);
    expect(ids(out.unshuffledQueue)).toEqual(["a", "b", "c"]);
    expect(out.currentIndex).toBe(1);
    expect(removeWhere(shuffled, () => false)).toBe(shuffled);
  });
});
