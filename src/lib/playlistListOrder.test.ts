import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api/db", () => ({ getSetting: async () => null, setSetting: async () => undefined }));
vi.mock("./api/youtube", () => ({ getPlaylistDetails: async () => ({}) }));

const stored = new Map<string, string>();
vi.mock("./storage/profileStorage", () => ({
  profileStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  },
}));

import {
  loadPlaylistCustomOrder,
  loadPlaylistListOrder,
  savePlaylistCustomOrder,
  savePlaylistListOrder,
  sortStoredPlaylists,
} from "./playlistListOrder";
import type { StoredPlaylist } from "./playlistLibrary";

const playlist = (id: string, name: string, createdAt: string): StoredPlaylist => ({ id, name, createdAt, tracks: [] });

const a = playlist("a", "banana", "2024-01-01T00:00:00.000Z");
const b = playlist("b", "Apple", "2024-02-01T00:00:00.000Z");
const c = playlist("c", "cherry", "2024-03-01T00:00:00.000Z");
const ids = (list: StoredPlaylist[]) => list.map((item) => item.id);

describe("sortStoredPlaylists", () => {
  it("sorts by date and by name", () => {
    expect(ids(sortStoredPlaylists([a, b, c], "newest", []))).toEqual(["c", "b", "a"]);
    expect(ids(sortStoredPlaylists([c, b, a], "oldest", []))).toEqual(["a", "b", "c"]);
    expect(ids(sortStoredPlaylists([a, c, b], "name", []))).toEqual(["b", "a", "c"]);
  });

  it("follows the dragged order, with new playlists first", () => {
    expect(ids(sortStoredPlaylists([a, b, c], "custom", ["a", "b"]))).toEqual(["c", "a", "b"]);
    expect(ids(sortStoredPlaylists([a, b, c], "custom", ["b", "c", "a"]))).toEqual(["b", "c", "a"]);
  });
});

describe("saved order", () => {
  beforeEach(() => stored.clear());

  it("defaults to newest and remembers a choice", () => {
    expect(loadPlaylistListOrder()).toBe("newest");
    savePlaylistListOrder("custom");
    expect(loadPlaylistListOrder()).toBe("custom");
  });

  it("reads back the custom order and survives junk", () => {
    savePlaylistCustomOrder(["x", "y"]);
    expect(loadPlaylistCustomOrder()).toEqual(["x", "y"]);
    stored.set("flow_playlist_custom_order", "not json");
    expect(loadPlaylistCustomOrder()).toEqual([]);
  });
});
