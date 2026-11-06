import { describe, expect, it, vi } from "vitest";

vi.mock("./storage/profileStorage", () => {
  const stored = new Map<string, string>();
  return {
    profileStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
  };
});

import { downloadDetail, downloadedBytes, loadDownloadSort, saveDownloadSort, sortDownloadRecords } from "./downloadsSort";
import type { DownloadRecord } from "./api/downloads";

const record = (id: number, extra: Partial<DownloadRecord>): DownloadRecord => ({
  id,
  videoId: `v${id}`,
  title: `t${id}`,
  author: null,
  mediaKind: "video",
  filePath: "",
  thumbnailUrl: null,
  durationSeconds: null,
  qualityLabel: null,
  fileSizeBytes: null,
  collectionDbId: null,
  createdAt: "2026-01-01 10:00:00",
  ...extra,
} as DownloadRecord);

const a = record(1, { title: "banana", author: "Zed", fileSizeBytes: 100, createdAt: "2026-02-01 10:00:00" });
const b = record(2, { title: "Apple", author: "amy", fileSizeBytes: 900, createdAt: "2026-03-01 10:00:00" });
const c = record(3, { title: "cherry", author: null, fileSizeBytes: null, createdAt: "2026-01-01 10:00:00", mediaKind: "music" });
const ids = (sort: Parameters<typeof sortDownloadRecords>[1]) => sortDownloadRecords([a, b, c], sort).map((item) => item.id);

describe("sortDownloadRecords", () => {
  it("sorts each way", () => {
    expect(ids("newest")).toEqual([2, 1, 3]);
    expect(ids("oldest")).toEqual([3, 1, 2]);
    expect(ids("largest")).toEqual([2, 1, 3]);
    expect(ids("title")).toEqual([2, 1, 3]);
    expect(ids("channel")).toEqual([3, 2, 1]);
  });

  it("leaves the input alone", () => {
    const input = [a, b];
    sortDownloadRecords(input, "newest");
    expect(input).toEqual([a, b]);
  });
});

describe("downloadDetail", () => {
  it("gives the size and date it knows", () => {
    expect(downloadDetail(record(1, { fileSizeBytes: 5 * 1024 * 1024 }))).toMatch(/MB • .*2026/);
    expect(downloadDetail(record(1, { createdAt: "nonsense", fileSizeBytes: null }))).toBe("");
  });
});

describe("downloadedBytes", () => {
  it("counts by kind", () => {
    expect(downloadedBytes([a, b, record(4, { mediaKind: "music", fileSizeBytes: 5 })])).toEqual({ video: 1000, music: 5 });
  });
});

describe("the saved sort", () => {
  it("defaults to newest and remembers a choice", () => {
    expect(loadDownloadSort()).toBe("newest");
    saveDownloadSort("largest");
    expect(loadDownloadSort()).toBe("largest");
  });
});
