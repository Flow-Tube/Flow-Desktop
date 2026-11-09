import { describe, expect, it } from "vitest";

import type { SongItem } from "../../types/music";
import {
  chosenFadeSeconds,
  crossfadeStart,
  skipFadeSeconds,
  SKIP_BLEND_SECONDS,
  type CrossfadeQueue,
  type CrossfadeSettings,
} from "./crossfade";

const song = (id: string, album: string | null = null): SongItem => ({
  id,
  title: id,
  artists: [],
  album: album ? { id: album, name: album } : null,
  duration: 200,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const queue = (patch: Partial<CrossfadeQueue> = {}): CrossfadeQueue => {
  const songs = [song("a"), song("b")];
  return {
    queue: songs,
    currentIndex: 0,
    currentTrack: songs[0]!,
    repeatMode: "none",
    isPlaying: true,
    loadingStreamId: null,
    duration: 200,
    ...patch,
  };
};

const settings = (patch: Partial<CrossfadeSettings> = {}): CrossfadeSettings => ({
  seconds: 6,
  keepAlbums: true,
  onAutoAdvance: true,
  onManualSkip: true,
  ...patch,
});

describe("crossfadeStart", () => {
  it("starts the chosen length before the end", () => {
    expect(crossfadeStart(queue(), settings(), 194, 1, false)).toEqual({ index: 1, seconds: 6 });
    expect(crossfadeStart(queue(), settings(), 193.9, 1, false)).toBeNull();
  });

  it("shortens the fade to what is left after a late seek", () => {
    expect(crossfadeStart(queue(), settings(), 198, 1, false)).toEqual({ index: 1, seconds: 2 });
  });

  it("lasts the chosen length on the clock at any speed", () => {
    expect(crossfadeStart(queue(), settings(), 188, 2, false)).toEqual({ index: 1, seconds: 6 });
    expect(crossfadeStart(queue(), settings(), 187.9, 2, false)).toBeNull();
  });

  it("fades a song into its own start on Repeat one", () => {
    expect(crossfadeStart(queue({ repeatMode: "one" }), settings(), 195, 1, false)?.index).toBe(0);
  });

  it("fades short songs that can hold the fade", () => {
    expect(crossfadeStart(queue({ duration: 6.3 }), settings(), 1, 1, false)?.seconds).toBe(5.3);
    expect(crossfadeStart(queue({ duration: 6.2 }), settings(), 1, 1, false)).toBeNull();
  });

  it("does nothing while off, paused, loading, at the end of the queue or with the sleep timer at the end", () => {
    expect(crossfadeStart(queue(), settings({ seconds: 0 }), 195, 1, false)).toBeNull();
    expect(crossfadeStart(queue(), settings({ onAutoAdvance: false }), 195, 1, false)).toBeNull();
    expect(crossfadeStart(queue({ isPlaying: false }), settings(), 195, 1, false)).toBeNull();
    expect(crossfadeStart(queue({ loadingStreamId: "b" }), settings(), 195, 1, false)).toBeNull();
    expect(crossfadeStart(queue({ queue: [song("a")] }), settings(), 195, 1, false)).toBeNull();
    expect(crossfadeStart(queue(), settings(), 195, 1, true)).toBeNull();
  });

  it("keeps tracks of one album gapless only when asked, by album id or name", () => {
    const sameId = [song("a", "x"), song("b", "x")];
    const album = queue({ queue: sameId, currentTrack: sameId[0]! });
    expect(crossfadeStart(album, settings(), 195, 1, false)).toBeNull();
    expect(crossfadeStart(album, settings({ keepAlbums: false }), 195, 1, false)?.index).toBe(1);

    const sameName = [{ ...song("a"), album: { id: "", name: "Live" } }, { ...song("b"), album: { id: "", name: "Live" } }];
    expect(crossfadeStart(queue({ queue: sameName, currentTrack: sameName[0]! }), settings(), 195, 1, false)).toBeNull();
  });
});

describe("skipFadeSeconds", () => {
  it("fades over the chosen length, or what is left of the song", () => {
    expect(skipFadeSeconds(settings(), 30, 200, 1)).toBe(6);
    expect(skipFadeSeconds(settings(), 196, 200, 1)).toBe(4);
  });

  it("only blends briefly when skips don't fade, crossfade off included", () => {
    expect(skipFadeSeconds(settings({ onManualSkip: false }), 30, 200, 1)).toBe(SKIP_BLEND_SECONDS);
    expect(skipFadeSeconds(settings({ seconds: 0 }), 30, 200, 1)).toBe(SKIP_BLEND_SECONDS);
  });

  it("cuts a song barely heard or about to end", () => {
    expect(skipFadeSeconds(settings(), 0.5, 200, 1)).toBe(0);
    expect(skipFadeSeconds(settings(), 198.5, 200, 1)).toBe(0);
    expect(skipFadeSeconds(settings(), 30, 0, 1)).toBe(0);
  });
});

describe("chosenFadeSeconds", () => {
  it("is 0 while off and stays within the offered lengths", () => {
    expect(chosenFadeSeconds(false, 3)).toBe(0);
    expect(chosenFadeSeconds(true, 0.25)).toBe(0.25);
    expect(chosenFadeSeconds(true, 0.1)).toBe(0.25);
    expect(chosenFadeSeconds(true, 30)).toBe(12);
  });
});
