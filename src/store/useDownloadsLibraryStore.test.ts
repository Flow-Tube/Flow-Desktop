import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteDownloads = vi.fn();
const listDownloads = vi.fn();
const getDownloadedVideoIds = vi.fn();
vi.mock("../lib/api/downloads", () => ({
  clearDownloads: vi.fn(async () => undefined),
  deleteDownloads: (ids: number[]) => deleteDownloads(ids),
  listDownloads: () => listDownloads(),
  getDownloadedVideoIds: () => getDownloadedVideoIds(),
}));

import { runBeforeProfileSwitch } from "../lib/profiles/beforeSwitch";
import { DOWNLOAD_UNDO_MS, useDownloadsLibraryStore } from "./useDownloadsLibraryStore";
import { useUiStore } from "./useUiStore";

const record = (id: number, videoId: string) => ({ id, videoId, title: videoId, mediaKind: "video" });
const seeded = [record(1, "a"), record(2, "b"), record(3, "b")];
const ids = () => useDownloadsLibraryStore.getState().records.map((item) => item.id);

describe("deleting with Undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deleteDownloads.mockReset().mockResolvedValue(undefined);
    listDownloads.mockReset().mockResolvedValue(seeded);
    getDownloadedVideoIds.mockReset().mockResolvedValue(["a", "b"]);
    useUiStore.setState({ toast: null });
    useDownloadsLibraryStore.setState({ records: seeded as never, downloadedIds: new Set(["a", "b"]) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides at once and deletes when Undo has passed", () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    expect(ids()).toEqual([2, 3]);
    expect(useDownloadsLibraryStore.getState().downloadedIds.has("a")).toBe(false);
    expect(deleteDownloads).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.message).toBe("1 download deleted");

    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
    expect(deleteDownloads).toHaveBeenCalledWith([1]);
  });

  it("deletes at once when the window closes inside the Undo window", () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    window.dispatchEvent(new Event("beforeunload"));
    expect(deleteDownloads).toHaveBeenCalledWith([1]);
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
    expect(deleteDownloads).toHaveBeenCalledTimes(1);
  });

  it("deletes before a profile switch ends the process", async () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    const switching = runBeforeProfileSwitch();
    expect(deleteDownloads).toHaveBeenCalledWith([1]);
    await vi.advanceTimersByTimeAsync(300);
    await switching;
  });

  it("keeps a video marked saved while another copy of it remains", () => {
    useDownloadsLibraryStore.getState().removeWithUndo([2]);
    expect(useDownloadsLibraryStore.getState().downloadedIds.has("b")).toBe(true);
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
  });

  it("Undo brings them back without deleting", async () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    useUiStore.getState().toast?.actions[0]?.onSelect?.();
    await vi.waitFor(() => expect(ids()).toEqual([1, 2, 3]));
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
    expect(deleteDownloads).not.toHaveBeenCalled();
  });

  it("a reload while waiting keeps them hidden", async () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    await useDownloadsLibraryStore.getState().load();
    expect(ids()).toEqual([2, 3]);
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
  });

  it("a newer delete finishes the older one first", () => {
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    useDownloadsLibraryStore.getState().removeWithUndo([2]);
    expect(deleteDownloads).toHaveBeenCalledWith([1]);
    expect(deleteDownloads).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
    expect(deleteDownloads).toHaveBeenLastCalledWith([2]);
  });

  it("reports a failed delete and brings the rows back", async () => {
    deleteDownloads.mockRejectedValue(new Error("disk"));
    useDownloadsLibraryStore.getState().removeWithUndo([1]);
    vi.advanceTimersByTime(DOWNLOAD_UNDO_MS);
    await vi.waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't delete the download"));
    await vi.waitFor(() => expect(ids()).toEqual([1, 2, 3]));
  });
});
