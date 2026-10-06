import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  availablePlaylistSortOrders,
  loadPlaylistSortOrder,
  resolvePlaylistSortOrder,
  savePlaylistSortOrder,
  showsDateAdded,
  sortPlaylistVideos,
  type PlaylistSortOrder,
} from "./playlistSort";
import type { VideoSummary } from "../types/video";

const NOW = Date.UTC(2026, 9, 1, 12);
const DAY_MS = 86_400_000;

const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  ...extra,
});

// The publish ages deliberately run in a different order from the add order,
// so a "Date published" sort that silently returned the input would fail.
const tracks = [
  video("added1", { publishedText: "3 weeks ago", viewCountText: "1K views" }),
  video("added2", { publishedText: "5 years ago", viewCountText: "2M views" }),
  video("added3", { publishedText: "2 days ago", viewCountText: "500 views" }),
];

const ids = (videos: VideoSummary[]) => videos.map((v) => v.id);

describe("sortPlaylistVideos", () => {
  // Watch Later is stored newest-added-first (index 0 = most recently added).
  it.each<[PlaylistSortOrder, string[]]>([
    ["manual", ["added1", "added2", "added3"]],
    ["date_added_newest", ["added1", "added2", "added3"]],
    ["date_added_oldest", ["added3", "added2", "added1"]],
    ["date_published_newest", ["added3", "added1", "added2"]],
    ["date_published_oldest", ["added2", "added1", "added3"]],
    ["most_popular", ["added2", "added1", "added3"]],
  ])("orders '%s' for a newest-first list", (order, expected) => {
    expect(ids(sortPlaylistVideos(tracks, order, true, NOW))).toEqual(expected);
  });

  // Owned playlists append, so index 0 is the oldest addition.
  it.each<[PlaylistSortOrder, string[]]>([
    ["date_added_newest", ["added3", "added2", "added1"]],
    ["date_added_oldest", ["added1", "added2", "added3"]],
  ])("orders '%s' for an oldest-first list", (order, expected) => {
    expect(ids(sortPlaylistVideos(tracks, order, false, NOW))).toEqual(expected);
  });

  it("orders date added by each track's add time, whatever the stored order", () => {
    const timed = [
      video("middle", { addedAtInPlaylist: NOW - 2 * DAY_MS }),
      video("newest", { addedAtInPlaylist: NOW - DAY_MS }),
      video("oldest", { addedAtInPlaylist: NOW - 3 * DAY_MS }),
    ];
    for (const storedNewestFirst of [true, false]) {
      expect(ids(sortPlaylistVideos(timed, "date_added_newest", storedNewestFirst, NOW))).toEqual([
        "newest",
        "middle",
        "oldest",
      ]);
      expect(ids(sortPlaylistVideos(timed, "date_added_oldest", storedNewestFirst, NOW))).toEqual([
        "oldest",
        "middle",
        "newest",
      ]);
    }
  });

  it("puts untimed tracks behind timed ones, ordered by position", () => {
    // Owned playlists append: old1 was added before old2, and both before the timed track.
    const mixed = [video("old1"), video("old2"), video("timed", { addedAtInPlaylist: NOW })];
    expect(ids(sortPlaylistVideos(mixed, "date_added_newest", false, NOW))).toEqual(["timed", "old2", "old1"]);
    expect(ids(sortPlaylistVideos(mixed, "date_added_oldest", false, NOW))).toEqual(["old1", "old2", "timed"]);
  });

  it("ranks undated videos as the oldest", () => {
    const mixed = [video("undated"), video("dated", { publishedText: "1 day ago" })];
    expect(ids(sortPlaylistVideos(mixed, "date_published_newest", true, NOW))).toEqual(["dated", "undated"]);
    expect(ids(sortPlaylistVideos(mixed, "date_published_oldest", true, NOW))).toEqual(["undated", "dated"]);
  });

  it("keeps a stored publish time only when it is clearly older than the text", () => {
    const pinned = video("pinned", { publishedText: "2 days ago", publishedAt: NOW - 10 * DAY_MS });
    const close = video("close", { publishedText: "5 days ago", publishedAt: NOW - 5 * DAY_MS - 60_000 });
    const newer = video("newer", { publishedText: "3 days ago", publishedAt: NOW - DAY_MS });
    // pinned sorts at 10 days; close and newer sort by their text (5 and 3 days).
    expect(ids(sortPlaylistVideos([pinned, close, newer], "date_published_newest", true, NOW))).toEqual([
      "newer",
      "close",
      "pinned",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...tracks];
    sortPlaylistVideos(input, "date_added_oldest", true, NOW);
    expect(ids(input)).toEqual(["added1", "added2", "added3"]);
  });
});

describe("availablePlaylistSortOrders", () => {
  it("offers date added only for playlists kept in the library", () => {
    expect(availablePlaylistSortOrders(true)).toContain("date_added_newest");
    expect(availablePlaylistSortOrders(false)).toEqual([
      "manual",
      "most_popular",
      "date_published_newest",
      "date_published_oldest",
    ]);
  });
});

describe("showsDateAdded", () => {
  it("is true only while ordered by date added", () => {
    expect(showsDateAdded("date_added_newest")).toBe(true);
    expect(showsDateAdded("date_added_oldest")).toBe(true);
    expect(showsDateAdded("manual")).toBe(false);
    expect(showsDateAdded("date_published_newest")).toBe(false);
  });
});

describe("resolvePlaylistSortOrder", () => {
  it("falls back to manual for unknown or unavailable orders", () => {
    expect(resolvePlaylistSortOrder("most_popular", false)).toBe("most_popular");
    expect(resolvePlaylistSortOrder("date_added_oldest", false)).toBe("manual");
    expect(resolvePlaylistSortOrder("Date added (oldest)", true)).toBe("manual");
    expect(resolvePlaylistSortOrder(null, true)).toBe("manual");
  });
});

describe("playlist sort storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  it("remembers each playlist's order separately", () => {
    savePlaylistSortOrder("PL1", "most_popular");
    savePlaylistSortOrder("PL2", "date_published_oldest");
    expect(loadPlaylistSortOrder("PL1")).toBe("most_popular");
    expect(loadPlaylistSortOrder("PL2")).toBe("date_published_oldest");
    expect(loadPlaylistSortOrder("PL3")).toBeNull();
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem("flow_playlist_sort_orders", "not json");
    expect(loadPlaylistSortOrder("PL1")).toBeNull();
  });
});
