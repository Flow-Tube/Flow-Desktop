import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LyricsResult } from "./types";
import type { DownloadProgress } from "../api/downloads";
import type { SongItem } from "../../types/music";

let result: LyricsResult | null = null;
const saved: Array<[string, string]> = [];

vi.mock("./lyricsHelper", async (original) => ({
  ...(await original<typeof import("./lyricsHelper")>()),
  getLyrics: async () => result,
}));
vi.mock("../api/lyrics", () => ({
  saveDownloadLyrics: async (videoId: string, lrc: string) => {
    saved.push([videoId, lrc]);
    return true;
  },
}));

const { saveLyricsWithDownload } = await import("./downloadLyrics");
const { useDownloadStore } = await import("../../store/useDownloadStore");

const track: SongItem = {
  id: "dQw4w9WgXcQ",
  videoId: "dQw4w9WgXcQ",
  title: "Song",
  artists: [{ name: "Band", id: null }],
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  playlistId: null,
  params: null,
};

const progress = (id: string, status: DownloadProgress["status"]): DownloadProgress => ({
  id,
  title: "Song",
  mediaKind: "music",
  qualityLabel: "",
  filePath: "/music/Song.m4a",
  downloadedBytes: 0,
  totalBytes: null,
  status,
  error: null,
  errorKind: null,
  logs: [],
  videoId: track.videoId,
  thumbnailUrl: null,
  collectionDbId: null,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const synced = Array.from({ length: 6 }, (_, i) => ({ time: 10_000 + i * 5000, text: `line ${i}` }));

beforeEach(() => {
  saved.length = 0;
  result = null;
});

describe("lyrics saved with a download", () => {
  it("writes the chain's synced lyrics as LRC once the download completes", async () => {
    result = { entries: synced, provider: "LrcLib" };
    saveLyricsWithDownload(track, "d1");
    useDownloadStore.getState().updateProgress(progress("d1", "downloading"));
    await flush();
    expect(saved).toEqual([]);
    useDownloadStore.getState().updateProgress(progress("d1", "completed"));
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]![1].split("\n")[0]).toBe("[00:10.00]line 0");
  });

  it("keeps plain lyrics plain, and writes nothing for a failed download", async () => {
    result = { entries: [{ time: 0, text: "just words" }], provider: "YouTube" };
    saveLyricsWithDownload(track, "d2");
    useDownloadStore.getState().updateProgress(progress("d2", "completed"));
    await flush();
    expect(saved[0]![1]).toBe("just words");
    saveLyricsWithDownload(track, "d3");
    useDownloadStore.getState().updateProgress(progress("d3", "failed"));
    await flush();
    expect(saved).toHaveLength(1);
  });
});
