import { describe, expect, it, vi } from "vitest";

vi.mock("./storage/profileStorage", () => {
  const stored = new Map<string, string>();
  return {
    profileStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
  };
});

import {
  DEFAULT_LIKES_SORT,
  LIKES_SORT_ORDERS,
  likedActionKind,
  likedDownloadTargets,
  likedPlaylistFile,
  loadLikesSortOrder,
  saveLikesSortOrder,
  sortLikedItems,
} from "./likedItems";
import type { LikedItem } from "../store/useLikesStore";
import type { SongItem } from "../types/music";

const ID = "dQw4w9WgXcQ";

const video = (id: string, likedAt: string, durationSeconds: number, viewCountText = "1 view"): LikedItem => ({
  kind: "video",
  id,
  likedAt,
  video: { id, title: id, channelName: "c", durationSeconds, viewCountText },
});

const song = (id: string, likedAt: string, duration: number): LikedItem => ({
  kind: "music",
  id,
  likedAt,
  song: { id, videoId: id, title: id, artists: [], album: null, duration, musicVideoType: null, thumbnail: "", explicit: false, playlistId: null, params: null } as SongItem,
});

const items = [
  video("new", "2026-03-01T00:00:00.000Z", 10),
  song("mid", "2026-02-01T00:00:00.000Z", 500),
  video("old", "2026-01-01T00:00:00.000Z", 100, "9M views"),
];
const ids = (list: LikedItem[]) => list.map((item) => item.id);

describe("sortLikedItems", () => {
  it("sorts by when each was liked, either way", () => {
    expect(ids(sortLikedItems(items, "date_added_newest"))).toEqual(["new", "mid", "old"]);
    expect(ids(sortLikedItems(items, "date_added_oldest"))).toEqual(["old", "mid", "new"]);
  });

  it("sorts songs and videos together by length", () => {
    expect(ids(sortLikedItems(items, "longest"))).toEqual(["mid", "old", "new"]);
    expect(ids(sortLikedItems(items, "shortest"))).toEqual(["new", "old", "mid"]);
  });

  it("keeps a song and a video that share an id apart", () => {
    const both = [video("same", "2026-03-01T00:00:00.000Z", 1), song("same", "2026-02-01T00:00:00.000Z", 2)];
    expect(sortLikedItems(both, "longest").map((item) => item.kind)).toEqual(["music", "video"]);
  });
});

describe("the likes sort", () => {
  it("has no Manual and defaults to newest, then remembers a choice", () => {
    expect(LIKES_SORT_ORDERS).not.toContain("manual");
    expect(loadLikesSortOrder()).toBe(DEFAULT_LIKES_SORT);
    saveLikesSortOrder("longest");
    expect(loadLikesSortOrder()).toBe("longest");
  });
});

describe("likedActionKind", () => {
  it("takes the videos when both are on show, and music only when only music is", () => {
    expect(likedActionKind(items)).toBe("video");
    expect(likedActionKind([song("a", "2026-01-01T00:00:00.000Z", 1)])).toBe("music");
    expect(likedActionKind([])).toBeNull();
  });
});

describe("what leaves the list", () => {
  it("downloads songs as songs and videos as videos", () => {
    expect(likedDownloadTargets(items).map((target) => target.kind)).toEqual(["video", "music", "video"]);
  });

  it("never saves songs into a video file", () => {
    const file = likedPlaylistFile([video(ID, "2026-03-01T00:00:00.000Z", 10), song("aaaaaaaaaaa", "2026-02-01T00:00:00.000Z", 5)], "Likes");
    expect(file?.isMusic).toBe(false);
    expect(file?.videos.map((entry) => entry.id)).toEqual([ID]);
    expect(file?.videos[0]?.addedAt).toBe(Date.parse("2026-03-01T00:00:00.000Z"));
  });

  it("saves a music-only view as a music playlist", () => {
    const file = likedPlaylistFile([song(ID, "2026-02-01T00:00:00.000Z", 5)], "Likes");
    expect(file?.isMusic).toBe(true);
    expect(file?.videos[0]?.isMusic).toBe(true);
  });

  it("has nothing to save from an empty view", () => {
    expect(likedPlaylistFile([], "Likes")).toBeNull();
  });
});
