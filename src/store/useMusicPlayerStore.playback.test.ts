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
    getErrorCode: vi.fn((): number | null => null),
    wantsAac: vi.fn(() => false),
    activeBypassesGraph: vi.fn(() => false),
    getCurrentTime: vi.fn(() => 0),
  },
  resolveMusicStream: vi.fn(),
  getMusicWatchQueue: vi.fn(),
}));

vi.mock("../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: engine }));
vi.mock("../lib/musicStreamResolution", () => ({
  resolveMusicStream,
  prefetchMusicStream: vi.fn(),
  invalidateMusicStream: vi.fn(),
  isResolveTimeout: (error: { timedOut?: boolean }) => error?.timedOut === true,
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

  it("starts a handed-over queue at its position in one load, paused when asked", async () => {
    await useMusicPlayerStore.getState().playQueue([song("a"), song("b")], 1, null, { at: 42, autoplay: false });

    expect(resolveMusicStream).toHaveBeenCalledTimes(1);
    expect(engine.seekWhenReady).toHaveBeenCalledWith(42);
    expect(engine.play).not.toHaveBeenCalled();
    expect(useMusicPlayerStore.getState()).toMatchObject({ isPlaying: false, progress: 42 });
  });

  it("retries a failed lookup once before showing an error", async () => {
    resolveMusicStream.mockRejectedValueOnce({ kind: "streaming", message: "timed out" });
    await useMusicPlayerStore.getState().playTrack(song("flaky"));

    expect(resolveMusicStream).toHaveBeenCalledTimes(2);
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(useMusicPlayerStore.getState().streamError).toBeNull();
  });
});

describe("the equalizer starting on macOS", () => {
  it("loads the song playing again as AAC from where it is", async () => {
    await useMusicPlayerStore.getState().playTrack(song("opus"));
    engine.wantsAac.mockReturnValue(true);
    engine.activeBypassesGraph.mockReturnValue(true);
    engine.getCurrentTime.mockReturnValue(42);

    useMusicPlayerStore.getState()._reloadForWebAudio();

    await vi.waitFor(() =>
      expect(resolveMusicStream).toHaveBeenLastCalledWith("opus", expect.anything(), { preferAac: true }),
    );
    await vi.waitFor(() => expect(engine.seekWhenReady).toHaveBeenLastCalledWith(42));
    expect(engine.clearPreload).toHaveBeenCalled();
    engine.wantsAac.mockReturnValue(false);
    engine.activeBypassesGraph.mockReturnValue(false);
    engine.getCurrentTime.mockReturnValue(0);
  });
});

describe("recovering from a playback error", () => {
  const MEDIA_ERR_NETWORK = 2;
  const MEDIA_ERR_DECODE = 3;
  const store = () => useMusicPlayerStore.getState();
  const fail = async (code: number | null) => {
    engine.getErrorCode.mockReturnValue(code);
    const loads = engine.load.mock.calls.length;
    store()._onPlaybackError();
    // A recovery reloads the element; a refusal to recover does not.
    await Promise.resolve();
    await vi.waitFor(() => expect(engine.load.mock.calls.length).toBeGreaterThanOrEqual(loads));
  };

  afterEach(() => {
    vi.useRealTimers();
    engine.getErrorCode.mockReturnValue(null);
  });

  it("looks the track up again and resumes where it stopped", async () => {
    await store().playTrack(song("expiring"));
    useMusicPlayerStore.setState({ progress: 42 });

    store()._onPlaybackError();
    await vi.waitFor(() => expect(engine.seekWhenReady).toHaveBeenLastCalledWith(42));
    expect(store().streamError).toBeNull();
    expect(store().isPlaying).toBe(true);
  });

  it("recovers each expired link up to the limit, then names the failure", async () => {
    await store().playTrack(song("dying"));
    for (let i = 0; i < 3; i++) {
      await fail(MEDIA_ERR_NETWORK);
      await vi.waitFor(() => expect(store().loadingStreamId).toBeNull());
      expect(store().streamError).toBeNull();
    }
    await fail(MEDIA_ERR_NETWORK);
    expect(store().streamErrorKind).toBe("streamExpired");
    expect(store().streamError).not.toContain("Playback failed");
  });

  it("forgives earlier failures after two minutes of clean playback", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await store().playTrack(song("long-pauses"));
    for (let i = 0; i < 3; i++) {
      await fail(MEDIA_ERR_NETWORK);
      await vi.waitFor(() => expect(store().loadingStreamId).toBeNull());
    }
    useMusicPlayerStore.setState({ isBuffering: false, isPlaying: true });
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
    store()._syncTime(100, 200);

    await fail(MEDIA_ERR_NETWORK);
    await vi.waitFor(() => expect(store().loadingStreamId).toBeNull());
    expect(store().streamError).toBeNull();
  });

  it("asks for AAC after a decode failure, and stops when AAC fails to decode too", async () => {
    await store().playTrack(song("odd-codec"));
    await fail(MEDIA_ERR_DECODE);
    await vi.waitFor(() =>
      expect(resolveMusicStream).toHaveBeenLastCalledWith("odd-codec", expect.anything(), { preferAac: true }),
    );
    await vi.waitFor(() => expect(store().loadingStreamId).toBeNull());

    await fail(MEDIA_ERR_DECODE);
    expect(store().streamErrorKind).toBe("mediaDecode");
  });

  it("keeps a paused song paused while it recovers", async () => {
    await store().playTrack(song("paused-expiry"));
    store().pause();
    engine.play.mockClear();
    await fail(MEDIA_ERR_NETWORK);
    await vi.waitFor(() => expect(store().loadingStreamId).toBeNull());

    expect(engine.play).not.toHaveBeenCalled();
    expect(store().isPlaying).toBe(false);
  });

  it("waits for the connection to come back, then carries on", async () => {
    await store().playTrack(song("offline"));
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await fail(MEDIA_ERR_NETWORK);
    expect(store().streamErrorKind).toBe("network");
    const lookups = resolveMusicStream.mock.calls.length;

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(resolveMusicStream.mock.calls.length).toBe(lookups + 1));
    await vi.waitFor(() => expect(store().streamError).toBeNull());
    online.mockRestore();
  });
});

describe("a lookup that times out", () => {
  it("joins the backend walk instead of starting a new one", async () => {
    const { invalidateMusicStream } = await import("../lib/musicStreamResolution");
    resolveMusicStream.mockRejectedValueOnce({ kind: "streaming", message: "timed out", timedOut: true });
    await useMusicPlayerStore.getState().playTrack(song("slow-ladder"));

    expect(resolveMusicStream).toHaveBeenCalledTimes(2);
    expect(invalidateMusicStream).not.toHaveBeenCalledWith("slow-ladder");
  });
});

describe("watching for a stalled connection", () => {
  afterEach(() => vi.useRealTimers());

  it("leaves a song paused during buffering alone", async () => {
    await useMusicPlayerStore.getState().playTrack(song("paused-buffering"));
    vi.useFakeTimers();
    engine.getBufferedEnd.mockReturnValue(10);
    useMusicPlayerStore.getState()._setBuffering(true);
    useMusicPlayerStore.getState().pause();
    engine.play.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolveMusicStream).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();

    // A waiting event after the pause starts no watch either.
    useMusicPlayerStore.getState()._setBuffering(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolveMusicStream).toHaveBeenCalledTimes(1);
  });

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

describe("a queue restored at launch", () => {
  const saved = (ids: string[], currentIndex: number, resumeAt: number) => ({
    queue: ids.map(song),
    currentIndex,
    resumeAt,
    queueSource: null,
    unshuffledQueue: null,
    radioQueuedIds: [],
    radioStationActive: false,
  });

  it("shows the song paused, and the first play loads it at the saved position", async () => {
    useMusicPlayerStore.getState().dismiss();
    useMusicPlayerStore.getState().restoreSavedQueue(saved(["restored-a", "restored-b"], 1, 73));

    let state = useMusicPlayerStore.getState();
    expect(state.currentTrack?.id).toBe("restored-b");
    expect(state.isPlaying).toBe(false);
    expect(state.progress).toBe(73);
    const { prefetchMusicStream } = await import("../lib/musicStreamResolution");
    expect(resolveMusicStream).not.toHaveBeenCalled();
    expect(prefetchMusicStream).not.toHaveBeenCalled();

    state.play();
    await vi.waitFor(() => expect(engine.seekWhenReady).toHaveBeenLastCalledWith(73));
    state = useMusicPlayerStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(resolveMusicStream).toHaveBeenCalledWith("restored-b", expect.anything(), expect.anything());
  });

  it("never replaces a song the user already started", async () => {
    await useMusicPlayerStore.getState().playTrack(song("chosen"));
    useMusicPlayerStore.getState().restoreSavedQueue(saved(["old"], 0, 0));
    expect(useMusicPlayerStore.getState().currentTrack?.id).toBe("chosen");
  });
});
