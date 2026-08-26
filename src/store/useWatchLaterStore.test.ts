import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

const loadStoredPlaylists = vi.fn();
const addVideoToWatchLater = vi.fn();
const removeVideoFromWatchLater = vi.fn();

vi.mock("../lib/playlistLibrary", () => ({
  PLAYLIST_LIBRARY_UPDATED_EVENT: "flow:playlist-library-updated",
  WATCH_LATER_PLAYLIST_ID: "watch-later",
  loadStoredPlaylists: (...args: unknown[]) => loadStoredPlaylists(...args),
  addVideoToWatchLater: (...args: unknown[]) => addVideoToWatchLater(...args),
  removeVideoFromWatchLater: (...args: unknown[]) => removeVideoFromWatchLater(...args),
}));

const { useWatchLaterStore } = await import("./useWatchLaterStore");

const video = (id: string) => ({ id, title: id }) as VideoSummary;

function libraryWith(ids: string[]) {
  return [
    { id: "watch-later", tracks: ids.map((id) => ({ id })) },
    { id: "other", tracks: [{ id: "elsewhere" }] },
  ];
}

describe("useWatchLaterStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWatchLaterStore.setState({ ids: new Set(), loaded: false });
    loadStoredPlaylists.mockResolvedValue(libraryWith(["a", "b"]));
    addVideoToWatchLater.mockResolvedValue(undefined);
    removeVideoFromWatchLater.mockResolvedValue(undefined);
  });

  it("reads only the Watch Later playlist's ids", async () => {
    await useWatchLaterStore.getState().load();

    const { ids } = useWatchLaterStore.getState();
    expect([...ids].sort()).toEqual(["a", "b"]);
    expect(ids.has("elsewhere")).toBe(false);
  });

  /*
    The whole point of the store: a feed mounts hundreds of cards at once, and
    they must not each trigger a read of the playlist library.
  */
  it("collapses concurrent loads into a single read", async () => {
    await Promise.all([
      useWatchLaterStore.getState().load(),
      useWatchLaterStore.getState().load(),
      useWatchLaterStore.getState().load(),
    ]);

    expect(loadStoredPlaylists).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous set when a read fails", async () => {
    await useWatchLaterStore.getState().load();
    loadStoredPlaylists.mockRejectedValueOnce(new Error("db down"));

    await useWatchLaterStore.getState().load();

    expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("adds optimistically, before the write resolves", async () => {
    let release = () => {};
    addVideoToWatchLater.mockReturnValueOnce(new Promise<void>((r) => { release = r; }));

    const pending = useWatchLaterStore.getState().add(video("c"));
    expect(useWatchLaterStore.getState().ids.has("c")).toBe(true);

    release();
    await pending;
  });

  it("rolls back an add when the write throws", async () => {
    await useWatchLaterStore.getState().load();
    addVideoToWatchLater.mockRejectedValueOnce(new Error("disk full"));

    await expect(useWatchLaterStore.getState().add(video("c"))).rejects.toThrow("disk full");
    expect(useWatchLaterStore.getState().ids.has("c")).toBe(false);
    expect([...useWatchLaterStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("rolls back a remove when the write throws", async () => {
    await useWatchLaterStore.getState().load();
    removeVideoFromWatchLater.mockRejectedValueOnce(new Error("disk full"));

    await expect(useWatchLaterStore.getState().remove("a")).rejects.toThrow("disk full");
    expect(useWatchLaterStore.getState().ids.has("a")).toBe(true);
  });

  /*
    Import and P2P sync mutate the library without going through this store, so
    the event is the only thing keeping the set honest for those paths.
  */
  it("reloads when the library reports an external change", async () => {
    await useWatchLaterStore.getState().load();
    loadStoredPlaylists.mockResolvedValue(libraryWith(["a", "b", "synced"]));

    window.dispatchEvent(new Event("flow:playlist-library-updated"));
    await vi.waitFor(() => {
      expect(useWatchLaterStore.getState().ids.has("synced")).toBe(true);
    });
  });

  it("ignores the event before the first load, so nothing reads eagerly", () => {
    window.dispatchEvent(new Event("flow:playlist-library-updated"));

    expect(loadStoredPlaylists).not.toHaveBeenCalled();
  });
});
