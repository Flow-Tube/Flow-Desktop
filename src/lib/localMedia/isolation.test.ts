import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SongItem } from "../../types/music";

const LOCAL_ID = "local_0123456789abcdef";

const mocks = vi.hoisted(() => ({
  recordSongHistory: vi.fn(),
  saveMusicResumePosition: vi.fn(() => Promise.resolve()),
  notePlayback: vi.fn(),
  invokeBackend: vi.fn(),
}));

vi.mock("../musicHistory", () => ({ recordSongHistory: mocks.recordSongHistory }));
vi.mock("../api/musicQueue", () => ({
  saveMusicResumePosition: mocks.saveMusicResumePosition,
  getMusicResumePosition: vi.fn(() => Promise.resolve(50)),
  loadMusicQueueState: vi.fn(),
  saveMusicQueueState: vi.fn(),
  clearMusicQueueState: vi.fn(),
}));
vi.mock("../../store/useLocalMediaStore", () => ({
  useLocalMediaStore: { getState: () => ({ notePlayback: mocks.notePlayback }) },
}));

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useLikesStore } from "../../store/useLikesStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { playing } from "../live/players";
import { resumePositionFor } from "../musicResume";
import { prefetchStreamInfo } from "../streamResolution";
import { musicListens } from "../useMusicListenHistory";

const song = (id: string): SongItem => ({
  id,
  title: "A song",
  artists: [],
  album: null,
  duration: 1200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppSettingsStore.setState({ values: { music_resume_long_tracks: "true" } });
  usePlayerStore.setState({ currentVideo: null, isPlaying: false });
  useMusicPlayerStore.setState({ currentTrack: null, isPlaying: false });
});

function listenTo(track: SongItem) {
  const now = 1_000_000;
  musicListens.switchTo(track, now);
  for (let second = 1; second <= 5; second++) {
    musicListens.tick(track, second, 1200, now + second * 500);
  }
  musicListens.switchTo(null, now + 3_000);
}

describe("a library file stays on this computer", () => {
  it("teaches MusicBrain nothing and leaves shared history alone", () => {
    listenTo(song(LOCAL_ID));
    expect(mocks.recordSongHistory).not.toHaveBeenCalled();
    expect(mocks.saveMusicResumePosition).not.toHaveBeenCalled();
    expect(mocks.notePlayback).toHaveBeenCalled();
  });

  it("a YouTube song is still recorded", () => {
    listenTo(song("dQw4w9WgXcQ"));
    expect(mocks.recordSongHistory).toHaveBeenCalled();
    expect(mocks.notePlayback).not.toHaveBeenCalled();
  });

  it("isn't announced to linked devices", () => {
    useMusicPlayerStore.setState({ currentTrack: song(LOCAL_ID), isPlaying: true });
    expect(playing()).toBeNull();
    useMusicPlayerStore.setState({ currentTrack: null, isPlaying: false });
    usePlayerStore.setState({ currentVideo: { id: LOCAL_ID, title: "My file", channelName: "" }, isPlaying: true });
    expect(playing()).toBeNull();
  });

  it("can't be liked, which would put it in a synced list", async () => {
    await expect(useLikesStore.getState().toggleSong(song(LOCAL_ID))).resolves.toBe(false);
    await expect(
      useLikesStore.getState().toggleVideo({ id: LOCAL_ID, title: "My file", channelName: "" }),
    ).resolves.toBe(false);
    expect(useLikesStore.getState().items).toEqual([]);
  });

  it("asks YouTube about nothing", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    prefetchStreamInfo(LOCAL_ID);
    await expect(resumePositionFor(song(LOCAL_ID))).resolves.toBe(0);
    expect(fetchStub).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
