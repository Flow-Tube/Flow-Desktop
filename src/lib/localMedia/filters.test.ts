import { describe, expect, it } from "vitest";

import type { LocalMediaFile, LocalMediaPlay } from "../api/localMedia";
import {
  applyLocalFilters,
  continueWatching,
  DEFAULT_LOCAL_FILTERS,
  folderNameOf,
  groupByFolder,
  isHiddenByRules,
  watchStateOf,
  type PlaysById,
} from "./filters";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function file(overrides: Partial<LocalMediaFile> = {}): LocalMediaFile {
  return {
    id: "local_0000000000000001",
    path: "/m/a.mp4",
    folderPath: "/m",
    kind: "video",
    title: "A",
    fileName: "a.mp4",
    artist: "",
    album: "",
    durationMs: 60_000,
    sizeBytes: 10,
    addedMs: NOW - 30 * DAY,
    modifiedMs: 0,
    width: 1920,
    height: 1080,
    frameRate: null,
    bitrateKbps: null,
    videoCodec: "",
    audioCodec: "",
    ...overrides,
  };
}

function plays(...entries: [string, number, number, number][]): PlaysById {
  return new Map(
    entries.map(([fileId, positionMs, durationMs, lastPlayedMs]): [string, LocalMediaPlay] => [
      fileId,
      { fileId, positionMs, durationMs, lastPlayedMs },
    ]),
  );
}

const NONE = plays();

describe("watchStateOf", () => {
  it("marks a recent unplayed file new, for seven days", () => {
    expect(watchStateOf(file({ addedMs: NOW - DAY }), NONE, NOW)).toBe("new");
    expect(watchStateOf(file({ addedMs: NOW - 8 * DAY }), NONE, NOW)).toBe("unwatched");
  });

  it("follows the file's own plays", () => {
    const item = file({ addedMs: NOW - DAY });
    expect(watchStateOf(item, plays([item.id, 30_000, 60_000, 1]), NOW)).toBe("inProgress");
    expect(watchStateOf(item, plays([item.id, 55_000, 60_000, 1]), NOW)).toBe("watched");
  });

  it("a recent file that was opened and left at the start is no longer new", () => {
    const item = file({ addedMs: NOW - DAY });
    expect(watchStateOf(item, plays([item.id, 0, 60_000, 1]), NOW)).toBe("unwatched");
  });
});

describe("applyLocalFilters", () => {
  const apply = (files: LocalMediaFile[], change: Partial<typeof DEFAULT_LOCAL_FILTERS>, played: PlaysById = NONE) =>
    applyLocalFilters(files, { ...DEFAULT_LOCAL_FILTERS, ...change }, played, NOW).map((item) => item.title);

  it("searches every word across title, file, folder, artist and album", () => {
    const files = [
      file({ title: "Holiday", fileName: "clip.mp4", folderPath: "/m/Summer" }),
      file({ title: "Song", artist: "Some Band", album: "Summer hits" }),
      file({ title: "Other" }),
    ];
    expect(apply(files, { query: "summer" })).toEqual(["Holiday", "Song"]);
    expect(apply(files, { query: "BAND summer" })).toEqual(["Song"]);
    expect(apply(files, { query: "absent" })).toEqual([]);
  });

  it("sorts by each key", () => {
    const old = file({ title: "b", addedMs: 1, durationMs: 9, sizeBytes: 1, id: "local_a" });
    const fresh = file({ title: "A", addedMs: 2, durationMs: 1, sizeBytes: 9, id: "local_b" });
    expect(apply([old, fresh], {})).toEqual(["A", "b"]);
    expect(apply([fresh, old], { sort: "name" })).toEqual(["A", "b"]);
    expect(apply([old, fresh], { sort: "length" })).toEqual(["b", "A"]);
    expect(apply([old, fresh], { sort: "size" })).toEqual(["A", "b"]);
    expect(apply([fresh, old], { sort: "recentlyPlayed" }, plays(["local_a", 1, 2, 50]))).toEqual(["b", "A"]);
  });

  it("filters by length band, short side and orientation", () => {
    const short = file({ title: "short", durationMs: 60_000, width: 1080, height: 1920 });
    const long = file({ title: "long", durationMs: 30 * 60_000, width: 3840, height: 2160 });
    const unknown = file({ title: "unknown", durationMs: 10 * 60_000, width: 0, height: 0 });
    const all = [short, long, unknown];
    expect(apply(all, { length: "short" })).toEqual(["short"]);
    expect(apply(all, { length: "medium" })).toEqual(["unknown"]);
    expect(apply(all, { length: "long" })).toEqual(["long"]);
    expect(apply(all, { quality: "fullHd" })).toEqual(["short"]);
    expect(apply(all, { quality: "uhd" })).toEqual(["long"]);
    expect(apply(all, { portraitOnly: true })).toEqual(["short"]);
  });

  it("video filters leave songs alone but Unwatched hides what was played", () => {
    const song = file({ kind: "audio", title: "song", width: 0, height: 0 });
    expect(apply([song], { quality: "uhd" })).toEqual(["song"]);
    expect(apply([song], { unwatchedOnly: true }, plays([song.id, 30_000, 60_000, 1]))).toEqual([]);
  });
});

describe("groupByFolder", () => {
  it("groups by folder with the newest folder and file first", () => {
    const groups = groupByFolder([
      file({ id: "1", folderPath: "/m/old", addedMs: 1, sizeBytes: 1 }),
      file({ id: "2", folderPath: "/m/new", addedMs: 5, sizeBytes: 2 }),
      file({ id: "3", folderPath: "/m/new", addedMs: 9, sizeBytes: 3 }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["new", "old"]);
    expect(groups[0]!.files.map((item) => item.id)).toEqual(["3", "2"]);
    expect(groups[0]!.sizeBytes).toBe(5);
  });

  it("names a Windows folder too", () => {
    expect(folderNameOf("C:\\Users\\me\\Music")).toBe("Music");
  });
});

describe("continueWatching", () => {
  it("lists files started and not finished, latest first", () => {
    const [a, b, c] = [file({ id: "a" }), file({ id: "b" }), file({ id: "c" })];
    const played = plays(["a", 10_000, 60_000, 1], ["b", 20_000, 60_000, 2], ["c", 59_000, 60_000, 3]);
    expect(continueWatching([a, b, c], played, NOW).map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("isHiddenByRules", () => {
  const rules = { hideRecordings: true, minAudioSeconds: 60 };

  it("hides chat app audio and short audio only", () => {
    expect(isHiddenByRules(file({ kind: "audio", folderPath: "/home/me/WhatsApp/Audio" }), rules)).toBe(true);
    expect(isHiddenByRules(file({ kind: "audio", folderPath: "C:\\Users\\me\\Recordings" }), rules)).toBe(true);
    expect(isHiddenByRules(file({ kind: "audio", durationMs: 5_000 }), rules)).toBe(true);
    expect(isHiddenByRules(file({ kind: "audio", durationMs: 120_000 }), rules)).toBe(false);
  });

  it("keeps a song of unknown length, every video, and everything with the rules off", () => {
    expect(isHiddenByRules(file({ kind: "audio", durationMs: 0 }), rules)).toBe(false);
    expect(isHiddenByRules(file({ kind: "video", durationMs: 5_000, folderPath: "/WhatsApp" }), rules)).toBe(false);
    const off = { hideRecordings: false, minAudioSeconds: 0 };
    expect(isHiddenByRules(file({ kind: "audio", durationMs: 5_000, folderPath: "/WhatsApp" }), off)).toBe(false);
  });
});
