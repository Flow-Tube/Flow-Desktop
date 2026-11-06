import type { LocalMediaFile, LocalMediaPlay } from "../api/localMedia";

const MINUTE_MS = 60_000;
const SHORT_MAX_MS = 4 * MINUTE_MS;
const MEDIUM_MAX_MS = 20 * MINUTE_MS;
const NEW_WINDOW_MS = 7 * 24 * 60 * MINUTE_MS;
const WATCHED_FRACTION = 0.9;

export type LocalSort = "dateAdded" | "name" | "length" | "size" | "recentlyPlayed";
export type LengthFilter = "any" | "short" | "medium" | "long";
export type QualityFilter = "any" | "sd" | "hd" | "fullHd" | "uhd";
export type WatchState = "new" | "unwatched" | "inProgress" | "watched";

export interface LocalFilters {
  query: string;
  sort: LocalSort;
  length: LengthFilter;
  quality: QualityFilter;
  portraitOnly: boolean;
  unwatchedOnly: boolean;
}

export const DEFAULT_LOCAL_FILTERS: LocalFilters = {
  query: "",
  sort: "dateAdded",
  length: "any",
  quality: "any",
  portraitOnly: false,
  unwatchedOnly: false,
};

export function isFiltering(filters: LocalFilters): boolean {
  return (
    filters.length !== "any" || filters.quality !== "any" || filters.portraitOnly || filters.unwatchedOnly
  );
}

function matchesLength(filter: LengthFilter, durationMs: number): boolean {
  switch (filter) {
    case "short":
      return durationMs < SHORT_MAX_MS;
    case "medium":
      return durationMs >= SHORT_MAX_MS && durationMs <= MEDIUM_MAX_MS;
    case "long":
      return durationMs > MEDIUM_MAX_MS;
    default:
      return true;
  }
}

/** By the video's short side, so a portrait 1080x1920 clip counts as Full HD like a landscape one. */
function matchesQuality(filter: QualityFilter, file: LocalMediaFile): boolean {
  if (filter === "any") return true;
  const shortSide = Math.min(file.width, file.height);
  if (shortSide <= 0) return false;
  switch (filter) {
    case "sd":
      return shortSide < 720;
    case "hd":
      return shortSide >= 720 && shortSide < 1080;
    case "fullHd":
      return shortSide >= 1080 && shortSide < 2160;
    default:
      return shortSide >= 2160;
  }
}

export type PlaysById = ReadonlyMap<string, LocalMediaPlay>;

/** Where a file stands with the viewer, from its own plays. */
export function watchStateOf(file: LocalMediaFile, plays: PlaysById, nowMs: number): WatchState {
  const play = plays.get(file.id);
  const fraction = play && play.durationMs > 0 ? play.positionMs / play.durationMs : null;
  if (fraction !== null && fraction >= WATCHED_FRACTION) return "watched";
  if (fraction !== null && fraction > 0) return "inProgress";
  const age = nowMs - file.addedMs;
  return !play && age >= 0 && age <= NEW_WINDOW_MS ? "new" : "unwatched";
}

export function progressFraction(file: LocalMediaFile, plays: PlaysById): number {
  const play = plays.get(file.id);
  if (!play || play.durationMs <= 0) return 0;
  return Math.min(1, play.positionMs / play.durationMs);
}

const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

const searchTextOf = (file: LocalMediaFile) =>
  [file.title, file.fileName, folderNameOf(file.folderPath), file.artist, file.album].join("\n").toLowerCase();

const compareBySort = (sort: LocalSort, plays: PlaysById) => {
  const lastPlayed = (file: LocalMediaFile) => plays.get(file.id)?.lastPlayedMs ?? 0;
  switch (sort) {
    case "name":
      return (a: LocalMediaFile, b: LocalMediaFile) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "length":
      return (a: LocalMediaFile, b: LocalMediaFile) => b.durationMs - a.durationMs;
    case "size":
      return (a: LocalMediaFile, b: LocalMediaFile) => b.sizeBytes - a.sizeBytes;
    case "recentlyPlayed":
      return (a: LocalMediaFile, b: LocalMediaFile) => lastPlayed(b) - lastPlayed(a) || b.addedMs - a.addedMs;
    default:
      return (a: LocalMediaFile, b: LocalMediaFile) => b.addedMs - a.addedMs;
  }
};

export function applyLocalFilters(
  files: LocalMediaFile[],
  filters: LocalFilters,
  plays: PlaysById,
  nowMs: number,
): LocalMediaFile[] {
  const words = searchWords(filters.query);
  return files
    .filter((file) => {
      if (words.length > 0) {
        const text = searchTextOf(file);
        if (!words.every((word) => text.includes(word))) return false;
      }
      if (!matchesLength(filters.length, file.durationMs)) return false;
      if (file.kind === "video" && !matchesQuality(filters.quality, file)) return false;
      if (filters.portraitOnly && !(file.height > file.width && file.width > 0)) return false;
      if (filters.unwatchedOnly) {
        const state = watchStateOf(file, plays, nowMs);
        if (state !== "new" && state !== "unwatched") return false;
      }
      return true;
    })
    .sort(compareBySort(filters.sort, plays));
}

export function folderNameOf(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folderPath;
}

export interface LocalFolderGroup {
  path: string;
  name: string;
  /** Newest first. */
  files: LocalMediaFile[];
  sizeBytes: number;
}

/** The folders holding `files`, the one with the newest file first. */
export function groupByFolder(files: LocalMediaFile[]): LocalFolderGroup[] {
  const groups = new Map<string, LocalMediaFile[]>();
  for (const file of files) {
    const group = groups.get(file.folderPath);
    if (group) group.push(file);
    else groups.set(file.folderPath, [file]);
  }
  return [...groups.entries()]
    .map(([path, members]) => ({
      path,
      name: folderNameOf(path),
      files: [...members].sort((a, b) => b.addedMs - a.addedMs),
      sizeBytes: members.reduce((sum, file) => sum + file.sizeBytes, 0),
    }))
    .sort((a, b) => (b.files[0]?.addedMs ?? 0) - (a.files[0]?.addedMs ?? 0));
}

/** Files started and not finished, most recently played first. */
export function continueWatching(files: LocalMediaFile[], plays: PlaysById, nowMs: number): LocalMediaFile[] {
  return files
    .filter((file) => watchStateOf(file, plays, nowMs) === "inProgress")
    .sort((a, b) => (plays.get(b.id)?.lastPlayedMs ?? 0) - (plays.get(a.id)?.lastPlayedMs ?? 0));
}

// Folders chat apps, recorders and the system keep audio in; they are rarely a music library.
const APP_AUDIO_PATH_FRAGMENTS = [
  "whatsapp",
  "telegram",
  "signal/",
  "viber",
  "threema",
  "voice note",
  "voicenote",
  "voice memos",
  "voice recorder",
  "voicerecorder",
  "voicemail",
  "recordings/",
  "recording/",
  "sound recorder",
  "soundrecorder",
  "call recording",
  "callrecord",
  "call_rec",
  "notifications/",
  "ringtones/",
  "alarms/",
];

export interface LocalVisibilitySettings {
  hideRecordings: boolean;
  minAudioSeconds: number;
}

/** Whether the library's own rules leave a file out. Length and folder rules only touch audio. */
export function isHiddenByRules(file: LocalMediaFile, settings: LocalVisibilitySettings): boolean {
  if (file.kind === "video") return false;
  if (settings.hideRecordings) {
    const folder = `${file.folderPath.replace(/\\/g, "/").toLowerCase()}/`;
    if (APP_AUDIO_PATH_FRAGMENTS.some((fragment) => folder.includes(fragment))) return true;
  }
  const minMs = settings.minAudioSeconds * 1000;
  return minMs > 0 && file.durationMs > 0 && file.durationMs < minMs;
}
