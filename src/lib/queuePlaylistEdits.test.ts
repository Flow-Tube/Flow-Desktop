import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => {
  settings.set(key, value);
});

vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
vi.mock("./api/youtube", () => ({ getPlaylistDetails: vi.fn() }));
vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn() }));

const showSaveToast = vi.fn();
const showSaveFailedToast = vi.fn();
vi.mock("./saveToast", () => ({
  showSaveToast: (options: unknown) => showSaveToast(options),
  showSaveFailedToast: (options: unknown) => showSaveFailedToast(options),
}));

import { WATCH_LATER_PLAYLIST_ID, getStoredPlaylistById } from "./playlistLibrary";
import { removeVideoFromQueuePlaylist } from "./queuePlaylistEdits";
import { usePlayerStore } from "../store/usePlayerStore";

const video = (id: string): VideoSummary => ({ id, title: id, channelName: "chan", thumbnailUrl: `thumb-${id}` });
const context = { id: WATCH_LATER_PLAYLIST_ID, title: "Watch Later", editable: true, reorderable: true };

const storedIds = async () =>
  (await getStoredPlaylistById(WATCH_LATER_PLAYLIST_ID))?.tracks.map((track) => track.id);
const queueIds = () => usePlayerStore.getState().queue.map((item) => item.id);

beforeEach(() => {
  settings.clear();
  setSetting.mockClear();
  showSaveToast.mockClear();
  showSaveFailedToast.mockClear();
  settings.set(
    "user_playlists",
    JSON.stringify([
      { id: WATCH_LATER_PLAYLIST_ID, name: "Watch Later", tracks: [video("a"), video("b"), video("c")], source: "Owned" },
    ]),
  );
  usePlayerStore.getState().setQueue([video("a"), video("b"), video("c")], 0, context);
});

describe("removeVideoFromQueuePlaylist", () => {
  it("removes the video from the playlist and offers an Undo that restores it in both places", async () => {
    usePlayerStore.getState().removeFromQueue(1);
    await removeVideoFromQueuePlaylist(context, video("b"), 1);

    expect(await storedIds()).toEqual(["a", "c"]);
    expect(showSaveToast).toHaveBeenCalledWith(
      expect.objectContaining({ destination: { kind: "watchLater" }, removed: true }),
    );

    const { undo } = showSaveToast.mock.calls[0]?.[0] as { undo: () => Promise<void> };
    await undo();
    expect(await storedIds()).toEqual(["a", "b", "c"]);
    expect(queueIds()).toEqual(["a", "b", "c"]);
  });

  it("leaves the queue alone on Undo once a different queue is playing", async () => {
    usePlayerStore.getState().removeFromQueue(1);
    await removeVideoFromQueuePlaylist(context, video("b"), 1);
    usePlayerStore.getState().setQueue([video("z")], 0);

    const { undo } = showSaveToast.mock.calls[0]?.[0] as { undo: () => Promise<void> };
    await undo();
    expect(await storedIds()).toEqual(["a", "b", "c"]);
    expect(queueIds()).toEqual(["z"]);
  });

  it("names a failed removal and offers Retry", async () => {
    setSetting.mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await removeVideoFromQueuePlaylist(context, video("b"), 1);

    expect(showSaveToast).not.toHaveBeenCalled();
    expect(showSaveFailedToast).toHaveBeenCalledWith(
      expect.objectContaining({ destination: { kind: "watchLater" }, removed: true, retry: expect.any(Function) }),
    );
  });
});
