import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MusicStreamInfo, SongItem } from "../types/music";

const song = (id: string): SongItem => ({
  id,
  title: `Song ${id}`,
  artists: [],
  album: null,
  duration: 200,
  musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const calls: string[] = [];
const { engine, resolveMusicStream, getMusicWatchQueue } = vi.hoisted(() => ({
  engine: {
    activatePreloaded: vi.fn(() => false),
    clearPreload: vi.fn(() => null),
    getActiveLoudness: vi.fn(() => -3),
    setLoudness: vi.fn(),
    load: vi.fn(async () => {}),
    seekWhenReady: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    getContextState: vi.fn(() => "running"),
    getBufferedEnd: vi.fn(() => 10),
  },
  resolveMusicStream: vi.fn(),
  getMusicWatchQueue: vi.fn(),
}));

vi.mock("../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: engine }));
vi.mock("../lib/musicStreamResolution", () => ({
  resolveMusicStream,
  prefetchMusicStream: vi.fn(),
  invalidateMusicStream: vi.fn(),
}));
vi.mock("../lib/musicPreload", () => ({ preloadTrack: vi.fn() }));
vi.mock("../lib/useDownloads", () => ({ findDownloadedRecord: () => undefined }));
vi.mock("./useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: { getState: () => ({ loaded: true, ensureLoaded: async () => {} }) },
}));
vi.mock("../lib/api/music", () => ({
  getMusicWatchQueue,
  getMusicQueueContinuation: vi.fn(),
  rankMusicCandidates: (items: SongItem[]) => Promise.resolve(items),
}));

import { useMusicPlayerStore } from "./useMusicPlayerStore";

const stream = (id: string) =>
  ({ videoId: id, audioUrl: `http://127.0.0.1/stream/${id}`, loudnessDb: -2 }) as MusicStreamInfo;

beforeEach(() => {
  calls.length = 0;
  engine.play.mockImplementation(async () => {
    calls.push("play");
  });
  getMusicWatchQueue.mockImplementation(async () => {
    calls.push("radio");
    return { items: [], continuation: null, radioPlaylistId: null };
  });
  resolveMusicStream.mockImplementation(async (id: string) => stream(id));
  useMusicPlayerStore.setState({ radioEnabled: true, isShuffle: false, repeatMode: "none" });
});

afterEach(() => {
  vi.clearAllMocks();
  engine.activatePreloaded.mockReturnValue(false);
});

describe("starting a track", () => {
  it("plays a preloaded track without looking it up again", async () => {
    engine.activatePreloaded.mockReturnValue(true);
    await useMusicPlayerStore.getState().playTrack(song("next"));

    expect(resolveMusicStream).not.toHaveBeenCalled();
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useMusicPlayerStore.getState().loudnessDb).toBe(-3);
  });

  it("fetches the radio only once the track is playing", async () => {
    await useMusicPlayerStore.getState().playTrack(song("first"));
    await Promise.resolve();

    expect(calls[0]).toBe("play");
    expect(calls).toContain("radio");
  });

  it("retries a failed lookup once before showing an error", async () => {
    resolveMusicStream.mockRejectedValueOnce({ kind: "streaming", message: "timed out" });
    await useMusicPlayerStore.getState().playTrack(song("flaky"));

    expect(resolveMusicStream).toHaveBeenCalledTimes(2);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useMusicPlayerStore.getState().streamError).toBeNull();
  });
});

describe("recovering from a playback error", () => {
  it("looks the track up again once and resumes where it stopped", async () => {
    await useMusicPlayerStore.getState().playTrack(song("expiring"));
    useMusicPlayerStore.setState({ progress: 42 });

    useMusicPlayerStore.getState()._onPlaybackError();
    await vi.waitFor(() => expect(engine.seekWhenReady).toHaveBeenLastCalledWith(42));
    expect(useMusicPlayerStore.getState().streamError).toBeNull();

    useMusicPlayerStore.getState()._onPlaybackError();
    expect(useMusicPlayerStore.getState().streamError).not.toBeNull();
  });
});

describe("watching for a stalled connection", () => {
  afterEach(() => vi.useRealTimers());

  it("recovers when no data arrives for fifteen seconds", async () => {
    await useMusicPlayerStore.getState().playTrack(song("stalls"));
    vi.useFakeTimers();
    useMusicPlayerStore.setState({ progress: 30 });
    engine.getBufferedEnd.mockReturnValue(10);

    useMusicPlayerStore.getState()._setBuffering(true);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(resolveMusicStream).toHaveBeenCalledTimes(2);
    expect(engine.seekWhenReady).toHaveBeenLastCalledWith(30);
  });

  it("leaves a slow connection alone while bytes keep arriving", async () => {
    await useMusicPlayerStore.getState().playTrack(song("slow"));
    vi.useFakeTimers();
    let buffered = 10;
    engine.getBufferedEnd.mockImplementation(() => (buffered += 1));

    useMusicPlayerStore.getState()._setBuffering(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(resolveMusicStream).toHaveBeenCalledTimes(1);
    useMusicPlayerStore.getState()._setBuffering(false);
  });
});
