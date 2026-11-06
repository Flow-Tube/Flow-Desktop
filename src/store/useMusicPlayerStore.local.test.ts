import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../types/music";

const LOCAL_ID = "local_0123456789abcdef";

const song = (id: string): SongItem => ({
  id,
  title: `Song ${id}`,
  artists: [],
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const { engine, resolveMusicStream, prefetchMusicStream, getLocalStream, getMusicWatchQueue } = vi.hoisted(() => ({
  engine: {
    activatePreloaded: vi.fn(() => false),
    armSkipFade: vi.fn(),
    clearPreload: vi.fn(() => null),
    getActiveLoudness: vi.fn(() => null),
    setLoudness: vi.fn(),
    load: vi.fn(async () => {}),
    seekWhenReady: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    getErrorCode: vi.fn((): number | null => 4),
    wantsAac: vi.fn(() => false),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  },
  resolveMusicStream: vi.fn(),
  prefetchMusicStream: vi.fn(),
  getLocalStream: vi.fn(),
  getMusicWatchQueue: vi.fn(),
}));

vi.mock("../lib/audio/musicAudioEngine", () => ({ musicAudioEngine: engine }));
vi.mock("../lib/musicStreamResolution", () => ({
  resolveMusicStream,
  prefetchMusicStream,
  invalidateMusicStream: vi.fn(),
  isResolveTimeout: () => false,
}));
vi.mock("../lib/musicPreload", () => ({ preloadTrack: vi.fn() }));
vi.mock("../lib/useDownloads", () => ({ findDownloadedRecord: () => undefined }));
vi.mock("./useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: { getState: () => ({ loaded: true, ensureLoaded: async () => {} }) },
}));
vi.mock("../lib/api/localMedia", () => ({ getLocalStream }));
vi.mock("../lib/api/music", () => ({
  getMusicWatchQueue,
  getMusicQueueContinuation: vi.fn(),
  rankMusicCandidates: (items: SongItem[]) => Promise.resolve(items),
}));
vi.mock("../lib/localMedia/playability", async (original) => {
  const actual = await original<typeof import("../lib/localMedia/playability")>();
  return {
    ...actual,
    localPlaybackError: (stream: { audioCodec: string }) =>
      actual.localPlaybackError(stream as never, (mime) => !mime.includes("ac-3")),
  };
});

import { useMusicPlayerStore } from "./useMusicPlayerStore";

const localStream = (overrides: Record<string, unknown> = {}) => ({
  url: "http://127.0.0.1:1/stream/token",
  contentType: "audio/mpeg",
  title: "t",
  artist: "",
  videoCodec: "",
  audioCodec: "mp3",
  durationSeconds: 200,
  positionSeconds: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  getLocalStream.mockResolvedValue(localStream());
  useMusicPlayerStore.setState({
    queue: [],
    currentTrack: null,
    currentIndex: -1,
    radioEnabled: true,
    radioStationActive: false,
    streamError: null,
    streamErrorKind: null,
    isShuffle: false,
    repeatMode: "none",
    loadingStreamId: null,
  });
});

describe("a library file in the music player", () => {
  it("plays from the file with no stream lookup", async () => {
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID)], 0);
    expect(getLocalStream).toHaveBeenCalledWith(LOCAL_ID);
    expect(engine.load).toHaveBeenCalledWith("http://127.0.0.1:1/stream/token", "audio/mpeg", 200);
    expect(resolveMusicStream).not.toHaveBeenCalled();
    expect(useMusicPlayerStore.getState().streamError).toBeNull();
  });

  it("starts no radio and warms no stream from a library queue", async () => {
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID), song("local_1123456789abcdef")], 0);
    await useMusicPlayerStore.getState()._ensureRadio();
    expect(getMusicWatchQueue).not.toHaveBeenCalled();
    expect(prefetchMusicStream).not.toHaveBeenCalled();
  });

  it("says when the file's sound can't play here, instead of a blank player", async () => {
    getLocalStream.mockResolvedValue(localStream({ audioCodec: "ac3" }));
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID)], 0);
    const state = useMusicPlayerStore.getState();
    expect(state.streamErrorKind).toBe("localAudioUnsupported");
    expect(state.isPlaying).toBe(false);
    expect(engine.load).not.toHaveBeenCalled();
  });

  it("says when the file went away", async () => {
    getLocalStream.mockRejectedValue({ kind: "localFileMissing", message: "gone" });
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID)], 0);
    expect(useMusicPlayerStore.getState().streamErrorKind).toBe("localFileMissing");
  });

  it("skips a file that can't play when more of the queue follows", async () => {
    getLocalStream.mockRejectedValueOnce({ kind: "localFileMissing", message: "gone" });
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID), song("local_1123456789abcdef")], 0);
    await vi.waitFor(() => expect(useMusicPlayerStore.getState().currentIndex).toBe(1));
    expect(useMusicPlayerStore.getState().streamError).toBeNull();
  });

  it("a media element refusal is final: a file reads the same on a retry", async () => {
    await useMusicPlayerStore.getState().playQueue([song(LOCAL_ID)], 0);
    engine.load.mockClear();
    useMusicPlayerStore.getState()._onPlaybackError();
    expect(useMusicPlayerStore.getState().streamErrorKind).toBe("localFormatUnsupported");
    expect(engine.load).not.toHaveBeenCalled();
  });
});
