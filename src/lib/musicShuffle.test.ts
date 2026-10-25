import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import { fisherYates, restoreOriginalOrder, shuffleFrom, shuffleUpcoming } from "./musicShuffle";

const song = (id: string) => ({ id, videoId: id }) as SongItem;
const ids = (tracks: SongItem[]) => tracks.map((t) => t.id);
const ten = Array.from({ length: 10 }, (_, i) => song(`s${i}`));

// A seeded generator, so the shuffled order is the same on every run.
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("fisherYates", () => {
  it("returns every item exactly once, in a new array", () => {
    const out = fisherYates(ten, seeded(1));
    expect(out).not.toBe(ten);
    expect(ids(out).sort()).toEqual(ids(ten).sort());
    expect(ids(out)).not.toEqual(ids(ten));
  });

  it("can put any item first", () => {
    const firsts = new Set<string>();
    const random = seeded(7);
    for (let i = 0; i < 400; i++) firsts.add(fisherYates(ten, random)[0]!.id);
    expect(firsts.size).toBe(10);
  });
});

describe("shuffleUpcoming", () => {
  it("keeps the played songs and the current one in place", () => {
    const out = shuffleUpcoming(ten, 3, seeded(2));
    expect(ids(out.slice(0, 4))).toEqual(["s0", "s1", "s2", "s3"]);
    expect(ids(out.slice(4)).sort()).toEqual(ids(ten.slice(4)).sort());
  });
});

describe("shuffleFrom", () => {
  it("plays the chosen song first and every other song once after it", () => {
    const out = shuffleFrom(ten, 5, seeded(3));
    expect(out[0]).toBe(ten[5]);
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBe(10);
  });
});

describe("restoreOriginalOrder", () => {
  it("puts the original order back and finds the current song in it", () => {
    const shuffled = shuffleUpcoming(ten, 0, seeded(4));
    const playing = shuffled[4]!;
    const { queue, currentIndex } = restoreOriginalOrder(ten, shuffled, playing);
    expect(queue).toEqual(ten);
    expect(queue[currentIndex]).toBe(playing);
  });

  it("leaves out what was removed and keeps what was added at the end", () => {
    const added = song("new");
    const shuffled = [...shuffleUpcoming(ten, 0, seeded(5)).filter((t) => t !== ten[2]), added];
    const { queue } = restoreOriginalOrder(ten, shuffled, shuffled[0]!);
    expect(ids(queue)).toEqual(["s0", "s1", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "new"]);
  });

  it("keeps a song queued twice as two entries", () => {
    const again = { ...ten[0]! };
    const { queue } = restoreOriginalOrder([...ten, again], [again, ...ten], ten[0]!);
    expect(queue).toHaveLength(11);
  });
});
