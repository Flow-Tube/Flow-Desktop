import { beforeEach, describe, expect, it, vi } from "vitest";

const startVideoDownload = vi.fn();
const startMusicDownload = vi.fn();
vi.mock("./downloadActions", () => ({
  startVideoDownload: (...args: unknown[]) => startVideoDownload(...args),
  startMusicDownload: (...args: unknown[]) => startMusicDownload(...args),
}));
vi.mock("./useDownloads", () => ({ isActiveStatus: (status: string) => status === "downloading" }));
vi.mock("../store/useDownloadsLibraryStore", () => ({
  useDownloadsLibraryStore: { getState: () => ({ ensureLoaded: async () => undefined, downloadedIds: new Set(["saved"]) }) },
}));
vi.mock("../store/useDownloadStore", () => ({
  useDownloadStore: { getState: () => ({ active: { job: { id: "job", videoId: "running", status: "downloading" }, old: { id: "old", videoId: "again", status: "failed" } } }) },
}));
vi.mock("../store/useAppSettingsStore", () => ({ useAppSettingsStore: { getState: () => ({ values: {} }) } }));
const showToast = vi.fn();
vi.mock("../store/useUiStore", () => ({ useUiStore: { getState: () => ({ showToast }) } }));

import { downloadManyWithToast, type DownloadTarget } from "./downloadMany";

const video = (id: string): DownloadTarget => ({ kind: "video", video: { id, title: id, channelName: "" } });

describe("downloadManyWithToast", () => {
  beforeEach(() => {
    startVideoDownload.mockReset().mockResolvedValue({ id: "x" });
    startMusicDownload.mockReset().mockResolvedValue({ id: "y" });
    showToast.mockClear();
  });

  it("skips what is saved or running and starts the rest", async () => {
    await downloadManyWithToast([video("saved"), video("running"), video("again"), video("new")]);
    expect(startVideoDownload.mock.calls.map(([target]) => target.id)).toEqual(["again", "new"]);
    expect(showToast).toHaveBeenCalledWith({ variant: "info", message: "Downloading 2 videos…" });
  });

  it("starts music as music", async () => {
    await downloadManyWithToast([{ kind: "music", song: { id: "s", videoId: "song", title: "s" } as never }]);
    expect(startMusicDownload).toHaveBeenCalledTimes(1);
    expect(startVideoDownload).not.toHaveBeenCalled();
  });

  it("says so when there is nothing new", async () => {
    await downloadManyWithToast([video("saved")]);
    expect(startVideoDownload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ variant: "info", message: "Already downloaded" });
  });

  it("reports the ones that would not start", async () => {
    startVideoDownload.mockRejectedValueOnce(new Error("no"));
    await downloadManyWithToast([video("a"), video("b")]);
    expect(showToast).toHaveBeenLastCalledWith({ variant: "error", message: "Couldn't start 1 download" });
  });
});
