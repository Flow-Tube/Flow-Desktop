import { describe, expect, it } from "vitest";

import type { SongItem } from "../types/music";
import {
  MAX_POOL_SIZE,
  MAX_RADIO_ANCHORS,
  MAX_TRACKS_PER_ARTIST,
  artistCounts,
  growPool,
  nextAnchor,
  nextBatch,
  primaryArtistKey,
  radioAnchors,
} from "./musicRadioPlanner";

// Distinct by default so the pool tests exercise pooling, not the per-artist cap.
const track = (id: string, artist: string = id): SongItem => ({
  id,
  title: id,
  artists: [{ id: null, name: artist }],
  album: null,
  duration: 100,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const ids = (tracks: SongItem[]) => tracks.map((t) => t.id);
const seedPool = (candidates: SongItem[], excluded: string[] = []) => growPool([], candidates, new Set(excluded));

describe("radio pool (ported from Android MusicRadioPlannerTest)", () => {
  it("a fresh pool never lists what is already queued", () => {
    expect(ids(seedPool([track("a"), track("b"), track("c")], ["a", "b"]))).toEqual(["c"]);
  });

  it("a fresh pool keeps the order it was given", () => {
    expect(ids(seedPool([track("c"), track("a"), track("b")]))).toEqual(["c", "a", "b"]);
  });

  it("growing the pool appends and never reorders what is on screen", () => {
    const grown = growPool([track("a"), track("b")], [track("c"), track("a")], new Set());
    expect(ids(grown)).toEqual(["a", "b", "c"]);
  });

  it("growing the pool with nothing new returns the same list", () => {
    const existing = [track("a"), track("b")];
    expect(growPool(existing, [track("a")], new Set())).toBe(existing);
  });

  it("the pool does not grow without bound over a long session", () => {
    const existing = Array.from({ length: MAX_POOL_SIZE - 2 }, (_, i) => track(`old${i}`));
    const grown = growPool(existing, Array.from({ length: 20 }, (_, i) => track(`new${i}`)), new Set());
    expect(grown).toHaveLength(MAX_POOL_SIZE);
    expect(ids(grown).slice(-2)).toEqual(["new0", "new1"]);
  });

  it("a full pool is left alone", () => {
    const existing = Array.from({ length: MAX_POOL_SIZE }, (_, i) => track(`old${i}`));
    expect(growPool(existing, [track("new")], new Set())).toBe(existing);
  });

  it("the queue takes the head of the pool", () => {
    const pool = [track("a"), track("b"), track("c"), track("d")];
    expect(ids(nextBatch(pool, new Set(), 2))).toEqual(["a", "b"]);
  });

  it("the queue skips pool entries it already holds", () => {
    const pool = [track("a"), track("b"), track("c")];
    expect(ids(nextBatch(pool, new Set(["a"]), 2))).toEqual(["b", "c"]);
  });

  it("one artist cannot fill the station", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => track(`x${i}`, "Same"));
    expect(seedPool(candidates)).toHaveLength(MAX_TRACKS_PER_ARTIST);
  });

  it("capping keeps an artist's best-placed tracks and the order around them", () => {
    const candidates = [track("a1", "A"), track("b1", "B"), track("a2", "A"), track("a3", "A"), track("c1", "C")];
    expect(ids(seedPool(candidates))).toEqual(["a1", "b1", "a2", "c1"]);
  });

  it("a top-up cannot sneak an artist past the cap", () => {
    const existing = [track("a1", "A"), track("a2", "A"), track("b1", "B")];
    const grown = growPool(existing, [track("a3", "A"), track("b2", "B")], new Set());
    expect(ids(grown)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("the station's songs waiting in the queue count toward the cap", () => {
    const grown = growPool([], [track("a2", "A"), track("a3", "A")], new Set(), [track("a1", "A")]);
    expect(ids(grown)).toEqual(["a2"]);
  });

  it("a varied page is kept whole", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => track(`t${i}`, `Artist ${i}`));
    expect(seedPool(candidates)).toHaveLength(6);
  });

  it("artists are counted by identity, not by track", () => {
    const counts = artistCounts([track("a1", "A"), track("a2", "A"), track("b1", "B")]);
    expect([...counts.values()]).toEqual([2, 1]);
  });

  it("keys an artist by browse id, then by name, and never caps an uncredited track", () => {
    expect(primaryArtistKey({ ...track("x"), artists: [{ id: "UC1", name: "A" }] })).toBe("UC1");
    expect(primaryArtistKey(track("x", " Mixed Case "))).toBe("mixed case");
    const uncredited = [1, 2, 3].map((i) => ({ ...track(`u${i}`), artists: [] }));
    expect(seedPool(uncredited)).toHaveLength(3);
  });
});

describe("radio anchors", () => {
  it("a station refills from the seed's nearest songs before anything else", () => {
    const anchors = radioAnchors("seed", [track("n1"), track("n2"), track("seed")]);
    expect(anchors).toEqual(["seed", "n1", "n2"]);
    expect(nextAnchor(anchors, new Set(["seed"]))).toBe("n1");
    expect(nextAnchor(anchors, new Set(["seed", "n1", "n2"]))).toBeNull();
  });

  it("anchors stop at the cap", () => {
    const page = Array.from({ length: 20 }, (_, i) => track(`t${i}`));
    expect(radioAnchors("seed", page)).toHaveLength(MAX_RADIO_ANCHORS);
  });
});
