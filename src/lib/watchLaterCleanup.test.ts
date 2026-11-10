import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
const records = vi.fn();
vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => void settings.set(key, value),
  getWatchRecords: (ids: string[]) => records(ids),
}));
vi.mock("./api/youtube", () => ({ getPlaylistDetails: vi.fn() }));
vi.mock("./api/recommendation", () => ({ logInteraction: vi.fn(async () => undefined) }));

import { countsAsWatched, noteWatchLaterFinished, noteWatchLaterProgress, sweepWatchedFromWatchLater } from "./watchLaterCleanup";
import { WATCH_LATER_PLAYLIST_ID, getStoredPlaylistById } from "./playlistLibrary";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";
import { useWatchLaterStore } from "../store/useWatchLaterStore";

const video = (id: string) => ({ id, title: id, channelName: "c" });
const seed = (ids: string[]) =>
  settings.set("user_playlists", JSON.stringify([{ id: WATCH_LATER_PLAYLIST_ID, name: "Watch Later", source: "Owned", tracks: ids.map(video) }]));
const ids = async () => (await getStoredPlaylistById(WATCH_LATER_PLAYLIST_ID))?.tracks.map((track) => track.id);
const setSwitch = (on: boolean) => useAppSettingsStore.setState({ values: { [SETTINGS.REMOVE_WATCHED_FROM_WATCH_LATER]: String(on) } });

describe("countsAsWatched", () => {
  it("needs 90% seen and under a minute left", () => {
    expect(countsAsWatched(90, 100)).toBe(true);
    expect(countsAsWatched(89, 100)).toBe(false);
    expect(countsAsWatched(3_500, 3_600)).toBe(false);
    expect(countsAsWatched(3_550, 3_600)).toBe(true);
    expect(countsAsWatched(0, 0)).toBe(false);
  });
});

describe("the watched sweep", () => {
  beforeEach(() => {
    settings.clear();
    records.mockReset();
    useUiStore.setState({ toast: null });
    seed(["seen", "fresh"]);
    records.mockResolvedValue([
      { videoId: "seen", watchDurationSeconds: 95, totalDurationSeconds: 100 },
      { videoId: "fresh", watchDurationSeconds: 5, totalDurationSeconds: 100 },
    ]);
  });

  it("does nothing while the switch is off", async () => {
    setSwitch(false);
    await sweepWatchedFromWatchLater([video("seen")], vi.fn());
    expect(records).not.toHaveBeenCalled();
    expect(await ids()).toEqual(["seen", "fresh"]);
  });

  it("takes out what was watched, says so, and Undo brings it back", async () => {
    setSwitch(true);
    const onChanged = vi.fn();
    await sweepWatchedFromWatchLater([video("seen"), video("fresh")], onChanged);
    expect(await ids()).toEqual(["fresh"]);
    expect(onChanged.mock.calls[0]?.[0].map((v: { id: string }) => v.id)).toEqual(["fresh"]);

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe("Removed 1 watched video");
    toast?.actions[0]?.onSelect?.();
    await vi.waitFor(async () => expect(await ids()).toEqual(["seen", "fresh"]));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it("stays quiet when nothing was watched", async () => {
    setSwitch(true);
    records.mockResolvedValue([]);
    await sweepWatchedFromWatchLater([video("fresh")], vi.fn());
    expect(useUiStore.getState().toast).toBeNull();
  });
});

describe("removal while watching", () => {
  beforeEach(async () => {
    settings.clear();
    seed(["a"]);
    useWatchLaterStore.setState({ ids: new Set(["a"]), loaded: true });
  });

  it("follows the switch and the threshold", async () => {
    setSwitch(false);
    noteWatchLaterFinished("a");
    noteWatchLaterProgress("a", 99, 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await ids()).toEqual(["a"]);

    setSwitch(true);
    noteWatchLaterProgress("a", 10, 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await ids()).toEqual(["a"]);

    noteWatchLaterProgress("a", 99, 100);
    await vi.waitFor(async () => expect(await ids()).toEqual([]));
  });
});
