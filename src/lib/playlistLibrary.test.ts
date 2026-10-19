import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => {
  settings.set(key, value);
});

vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
const getPlaylistDetails = vi.fn();
vi.mock("./api/youtube", () => ({
  getPlaylistDetails: (id: string) => getPlaylistDetails(id),
}));

import {
  WATCH_LATER_PLAYLIST_ID,
  addVideoToStoredPlaylist,
  addVideoToWatchLater,
  getStoredPlaylistById,
  savePlaylistToLibrary,
  updateStoredPlaylistTracks,
} from "./playlistLibrary";

const NOW = Date.UTC(2026, 9, 1, 12);
const OWNED_ID = "playlist-1";
const SAVED_ID = "PLsaved";

const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  thumbnailUrl: `thumb-${id}`,
  ...extra,
});

const seed = (playlists: unknown[]) => {
  settings.clear();
  setSetting.mockClear();
  getPlaylistDetails.mockReset();
  settings.set("user_playlists", JSON.stringify(playlists));
};

describe("updateStoredPlaylistTracks", () => {
  beforeEach(() => {
    seed([
      {
        id: WATCH_LATER_PLAYLIST_ID,
        name: "Watch Later",
        tracks: [video("a"), video("b"), video("c")],
        createdAt: "2024-01-01T00:00:00.000Z",
        source: "Owned",
      },
      {
        id: SAVED_ID,
        name: "Saved",
        tracks: [video("a")],
        createdAt: "2024-01-01T00:00:00.000Z",
        source: "Saved",
        thumbnailUrl: "card-thumb",
        videoCountText: "500 videos",
      },
    ]);
  });

  it("skips the write when an updater returns the stored tracks unchanged", async () => {
    await updateStoredPlaylistTracks(WATCH_LATER_PLAYLIST_ID, (tracks) => tracks);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("derives the thumbnail and count from the new tracks", async () => {
    const updated = await updateStoredPlaylistTracks(WATCH_LATER_PLAYLIST_ID, [video("c")]);
    expect(updated?.thumbnailUrl).toBe("thumb-c");
    expect(updated?.videoCountText).toBe("1 video");
  });

  it("keeps a saved playlist's full count text when its first-page snapshot changes", async () => {
    const updated = await updateStoredPlaylistTracks(SAVED_ID, [video("x"), video("y")]);
    expect(updated?.tracks.map((track) => track.id)).toEqual(["x", "y"]);
    expect(updated?.thumbnailUrl).toBe("thumb-x");
    expect(updated?.videoCountText).toBe("500 videos");
  });
});

describe("add times", () => {
  const addedAt = async (playlistId: string) =>
    Object.fromEntries(
      (await getStoredPlaylistById(playlistId))?.tracks.map((track) => [track.id, track.addedAtInPlaylist ?? null]) ?? [],
    );

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    seed([
      { id: WATCH_LATER_PLAYLIST_ID, name: "Watch Later", tracks: [video("old")], source: "Owned" },
      { id: OWNED_ID, name: "Mine", tracks: [video("old")], source: "Owned" },
      { id: SAVED_ID, name: "Saved", tracks: [video("kept", { addedAtInPlaylist: 1_000 })], source: "Saved" },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps a video added to Watch Later", async () => {
    await addVideoToWatchLater(video("new"));
    expect(await addedAt(WATCH_LATER_PLAYLIST_ID)).toEqual({ new: NOW, old: null });
  });

  it("stamps a video added to an owned playlist", async () => {
    await addVideoToStoredPlaylist(OWNED_ID, video("new"));
    expect(await addedAt(OWNED_ID)).toEqual({ old: null, new: NOW });
  });

  it("does not restamp a video already in the playlist", async () => {
    await addVideoToStoredPlaylist(OWNED_ID, video("new"));
    vi.setSystemTime(NOW + 60_000);
    await addVideoToStoredPlaylist(OWNED_ID, video("new"));
    expect((await addedAt(OWNED_ID)).new).toBe(NOW);
  });

  it("stamps a saved playlist's new tracks and keeps the times it already had", async () => {
    getPlaylistDetails.mockResolvedValue({ title: "Saved", videos: [video("kept"), video("fresh")] });
    await savePlaylistToLibrary({ type: "playlist", id: SAVED_ID, title: "Saved" });
    expect(await addedAt(SAVED_ID)).toEqual({ kept: 1_000, fresh: NOW });
  });
});
