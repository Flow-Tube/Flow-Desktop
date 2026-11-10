import { beforeEach, describe, expect, it, vi } from "vitest";

const startVideoDownload = vi.fn();
const startMusicDownload = vi.fn();
vi.mock("./downloadActions", () => ({
  startVideoDownload: (...args: unknown[]) => startVideoDownload(...args),
  startMusicDownload: (...args: unknown[]) => startMusicDownload(...args),
}));
const cancelDownload = vi.fn(async (_id: string) => true);
vi.mock("./api/downloads", () => ({ cancelDownload: (id: string) => cancelDownload(id) }));
const library = { ensureLoaded: async () => undefined, downloadedIds: new Set<string>() };
vi.mock("../store/useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: { getState: () => library },
}));
const active: Record<string, unknown> = {};
vi.mock("../store/useDownloadStore", () => ({
  useDownloadStore: { getState: () => ({ active }) },
}));

import { advanceWithoutAutoDownload, autoDownloadLikedSong, noteOpenedVideoResolved } from "./autoDownload";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

let counter = 0;
const video = (extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id: `v${++counter}`,
  title: "Video",
  channelName: "Chan",
  durationSeconds: 600,
  ...extra,
});
const on = () => useAppSettingsStore.setState({ values: { [SETTINGS.AUTO_DOWNLOAD_OPENED_VIDEOS]: "true", [SETTINGS.AUTO_DOWNLOAD_LIKED_MUSIC]: "true" } });

describe("download what you open", () => {
  beforeEach(() => {
    startVideoDownload.mockReset().mockResolvedValue({ id: "job" });
    startMusicDownload.mockReset().mockResolvedValue({ id: "job" });
    cancelDownload.mockClear();
    library.downloadedIds = new Set();
    for (const key of Object.keys(active)) delete active[key];
    useUiStore.setState({ toast: null });
    on();
  });

  it("stays off by default", async () => {
    useAppSettingsStore.setState({ values: {} });
    await noteOpenedVideoResolved(video());
    expect(startVideoDownload).not.toHaveBeenCalled();
  });

  it("saves an opened video once, with Undo", async () => {
    const opened = video();
    await noteOpenedVideoResolved(opened);
    await noteOpenedVideoResolved(opened);
    expect(startVideoDownload).toHaveBeenCalledTimes(1);

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe("Saving for offline");
    toast?.actions[0]?.onSelect?.();
    expect(cancelDownload).toHaveBeenCalledWith("job");

    // Undone: opening something else and coming back doesn't queue it again.
    await noteOpenedVideoResolved(video());
    startVideoDownload.mockClear();
    await noteOpenedVideoResolved(opened);
    expect(startVideoDownload).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<VideoSummary>]>([
    ["a live stream", { isLive: true }],
    ["an upcoming stream", { isUpcoming: true }],
    ["a Short", { isShort: true }],
    ["a video short enough to be a Short", { durationSeconds: 30 }],
  ])("leaves out %s", async (_label, extra) => {
    await noteOpenedVideoResolved(video(extra));
    expect(startVideoDownload).not.toHaveBeenCalled();
  });

  it("leaves out what autoplay moved to, and only that", async () => {
    advanceWithoutAutoDownload(() => video());
    await noteOpenedVideoResolved(video());
    expect(startVideoDownload).not.toHaveBeenCalled();
    await noteOpenedVideoResolved(video());
    expect(startVideoDownload).toHaveBeenCalledTimes(1);
  });

  it("still saves what the viewer opens after autoplay found nothing to play", async () => {
    advanceWithoutAutoDownload(() => null);
    await noteOpenedVideoResolved(video());
    expect(startVideoDownload).toHaveBeenCalledTimes(1);
  });

  it("never restarts a download already there, even a failed one", async () => {
    const saved = video();
    library.downloadedIds = new Set([saved.id]);
    await noteOpenedVideoResolved(saved);
    const failed = video();
    active.job = { id: "job", videoId: failed.id, status: "failed" };
    await noteOpenedVideoResolved(failed);
    expect(startVideoDownload).not.toHaveBeenCalled();
  });
});

describe("download liked songs", () => {
  const song = { id: "s", videoId: "song1", title: "Song", artists: [] } as unknown as SongItem;

  beforeEach(() => {
    startMusicDownload.mockReset().mockResolvedValue({ id: "job" });
    library.downloadedIds = new Set();
    for (const key of Object.keys(active)) delete active[key];
    on();
  });

  it("follows its switch", async () => {
    useAppSettingsStore.setState({ values: {} });
    await autoDownloadLikedSong(song);
    expect(startMusicDownload).not.toHaveBeenCalled();
    on();
    await autoDownloadLikedSong(song);
    expect(startMusicDownload).toHaveBeenCalledTimes(1);
  });

  it("skips a song already saved, and survives a failure", async () => {
    library.downloadedIds = new Set(["song1"]);
    await autoDownloadLikedSong(song);
    expect(startMusicDownload).not.toHaveBeenCalled();
    library.downloadedIds = new Set();
    startMusicDownload.mockRejectedValue(new Error("no"));
    await expect(autoDownloadLikedSong(song)).resolves.toBeUndefined();
  });
});
