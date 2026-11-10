import { beforeEach, describe, expect, it, vi } from "vitest";

const getLyrics = vi.fn();
vi.mock("./lyricsHelper", () => ({
  getLyrics: (request: unknown, signal: AbortSignal) => getLyrics(request, signal),
  lyricsRequestFor: (track: { videoId: string; duration: number }, duration: number) => ({ videoId: track.videoId, durationSec: duration }),
}));
const player = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../../store/useMusicPlayerStore", () => ({ useMusicPlayerStore: { getState: () => player.state } }));

const { fetchLyricsAhead, shouldFetchLyricsAhead, stopFetchingAhead } = await import("./lyricsAhead");

const song = (videoId: string, name = "Band") => ({ id: videoId, videoId, title: "Song", artists: [{ name }], duration: 200 });

describe("shouldFetchLyricsAhead", () => {
  it("wants another song, with names, online", () => {
    expect(shouldFetchLyricsAhead("a", "b", true, true)).toBe(true);
    expect(shouldFetchLyricsAhead("a", "a", true, true)).toBe(false);
    expect(shouldFetchLyricsAhead("a", null, true, true)).toBe(false);
    expect(shouldFetchLyricsAhead("a", "b", false, true)).toBe(false);
    expect(shouldFetchLyricsAhead("a", "b", true, false)).toBe(false);
  });

  it("never sends a local file's name out", () => {
    expect(shouldFetchLyricsAhead("a", "local_0123456789abcdef", true, true)).toBe(false);
  });
});

describe("fetchLyricsAhead", () => {
  beforeEach(() => {
    getLyrics.mockReset();
    getLyrics.mockResolvedValue(null);
    player.state = { queue: [song("a"), song("b")], currentIndex: 0, repeatMode: "none" };
  });

  it("looks up the next song", () => {
    fetchLyricsAhead("a");
    expect(getLyrics.mock.calls[0]![0]).toEqual({ videoId: "b", durationSec: 200 });
  });

  it("does nothing on the last song", () => {
    player.state = { queue: [song("a")], currentIndex: 0, repeatMode: "none" };
    fetchLyricsAhead("a");
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it("does nothing without an artist to search for", () => {
    player.state = { queue: [song("a"), song("b", "")], currentIndex: 0, repeatMode: "none" };
    fetchLyricsAhead("a");
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it("is stopped by a skip", () => {
    fetchLyricsAhead("a");
    const signal = getLyrics.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    stopFetchingAhead();
    expect(signal.aborted).toBe(true);
  });
});
