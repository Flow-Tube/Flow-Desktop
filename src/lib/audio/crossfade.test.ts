import { describe, expect, it } from "vitest";

import type { SongItem } from "../../types/music";
import { crossfadeTarget, skipFadeLength, type CrossfadeQueue } from "./crossfade";

const song = (id: string, albumId: string | null = null): SongItem => ({
  id,
  title: id,
  artists: [],
  album: albumId ? { id: albumId, name: albumId } : null,
  duration: 200,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const near = (patch: Partial<CrossfadeQueue> = {}): CrossfadeQueue => {
  const queue = [song("a"), song("b")];
  return {
    queue,
    currentIndex: 0,
    currentTrack: queue[0]!,
    isShuffle: false,
    repeatMode: "none",
    isPlaying: true,
    loadingStreamId: null,
    progress: 196,
    duration: 200,
    ...patch,
  };
};

describe("crossfadeTarget", () => {
  it("starts the fade once the song is inside its last seconds", () => {
    expect(crossfadeTarget(near(), 5)).toBe(1);
    expect(crossfadeTarget(near({ progress: 190 }), 5)).toBe(-1);
    expect(crossfadeTarget(near({ progress: 199.9 }), 5)).toBe(-1);
  });

  it("stays off when disabled, paused, loading, on repeat-one or at the end of the queue", () => {
    expect(crossfadeTarget(near(), 0)).toBe(-1);
    expect(crossfadeTarget(near({ isPlaying: false }), 5)).toBe(-1);
    expect(crossfadeTarget(near({ loadingStreamId: "a" }), 5)).toBe(-1);
    expect(crossfadeTarget(near({ repeatMode: "one" }), 5)).toBe(-1);
    expect(crossfadeTarget(near({ queue: [song("a")] }), 5)).toBe(-1);
  });

  it("keeps consecutive album tracks gapless unless shuffled", () => {
    const album = [song("a", "LP"), song("b", "LP")];
    const inOrder = near({ queue: album, currentTrack: album[0]! });
    expect(crossfadeTarget(inOrder, 5)).toBe(-1);
    expect(crossfadeTarget({ ...inOrder, isShuffle: true }, 5)).toBe(1);
  });

  it("never fades a song too short to hold the fade twice", () => {
    expect(crossfadeTarget(near({ duration: 8, progress: 5 }), 5)).toBe(-1);
  });
});

describe("skipFadeLength", () => {
  it("fades for the chosen length, or what's left of the song", () => {
    expect(skipFadeLength(5, 30, 200)).toBe(5);
    expect(skipFadeLength(5, 197, 200)).toBe(3);
  });

  it("cuts when off, barely heard or too near the end", () => {
    expect(skipFadeLength(0, 30, 200)).toBe(0);
    expect(skipFadeLength(5, 0.5, 200)).toBe(0);
    expect(skipFadeLength(5, 199, 200)).toBe(0);
  });
});

describe("keep albums off", () => {
  it("fades between tracks of the same album", () => {
    const album = { name: "A", id: "same" };
    const q = near();
    const inOrder = {
      ...q,
      currentTrack: { ...q.currentTrack!, album },
      queue: q.queue.map((track) => ({ ...track, album })),
    };
    expect(crossfadeTarget(inOrder, 5, true)).toBe(-1);
    expect(crossfadeTarget(inOrder, 5, false)).toBe(1);
  });
});
