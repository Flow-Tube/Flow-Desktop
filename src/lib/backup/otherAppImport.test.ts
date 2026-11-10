import { beforeEach, describe, expect, it, vi } from "vitest";

const importOtherApp = vi.fn();
const refreshAfterRestore = vi.fn();
vi.mock("../api/backup", () => ({ importOtherApp: (...args: unknown[]) => importOtherApp(...args) }));
vi.mock("./refreshAfterRestore", () => ({ refreshAfterRestore: () => refreshAfterRestore() }));

import { importFailureMessage, importReportSummary, runOtherAppImport } from "./otherAppImport";
import { IMPORT_SOURCES } from "./importSources";

const EMPTY = { subscriptions: 0, history: 0, playlists: 0, playlistVideos: 0, musicPlaylists: 0, musicLibrary: 0, likes: 0 };

describe("imports from other apps", () => {
  beforeEach(() => {
    importOtherApp.mockReset();
    refreshAfterRestore.mockReset();
  });

  it("says what was added, in the singular where it fits", () => {
    expect(importReportSummary({ ...EMPTY, subscriptions: 1, history: 2, playlists: 1, playlistVideos: 3, likes: 5 }))
      .toBe("1 subscription, 2 history entries, 1 playlist (3 videos), 5 likes");
  });

  it("says so when nothing was new", () => {
    expect(importReportSummary(EMPTY)).toBe("Imported. Nothing new was found.");
  });

  it("has a message for every failure", () => {
    for (const reason of ["invalid_format", "too_large", "no_content", "no_entries", "no_videos", "no_likes", "failed"] as const) {
      expect(importFailureMessage(reason).length).toBeGreaterThan(0);
    }
  });

  it("reloads the stores after an import, and not after a failed one", async () => {
    importOtherApp.mockResolvedValue({ type: "failed", reason: "no_content" });
    await runOtherAppImport("TAKEOUT", ["a.zip"]);
    expect(refreshAfterRestore).not.toHaveBeenCalled();

    importOtherApp.mockResolvedValue({ type: "done", report: EMPTY });
    await runOtherAppImport("TAKEOUT", ["a.zip", "b.zip"]);
    expect(refreshAfterRestore).toHaveBeenCalledTimes(1);
    expect(importOtherApp.mock.calls[1]?.[1]).toEqual(["a.zip", "b.zip"]);
  });

  it("offers Takeout as several files at once, and everything by source", () => {
    const options = IMPORT_SOURCES.flatMap((source) => source.options);
    expect(options.filter((option) => option.several).map((option) => option.kind)).toEqual(["TAKEOUT"]);
    expect(new Set(options.map((option) => option.kind)).size).toBe(options.length);
    expect(IMPORT_SOURCES.map((source) => source.id)).toEqual(["youtube", "newpipe", "libretube", "freetube", "metrolist"]);
  });
});
