import { create } from "zustand";
import { profileStorage } from "../lib/storage/profileStorage";

export interface LocalSubtitleFile {
  name: string;
  path: string;
}

export interface VideoSubtitleState {
  files: LocalSubtitleFile[];
  /** How far captions move against the picture: later above zero, earlier below. */
  offsetMs: number;
}

type Saved = Record<string, VideoSubtitleState>;

const STORAGE_KEY = "flow_local_subtitles";
/** Kept per video, so the oldest entries go first once there are this many. */
const MAX_VIDEOS = 200;
export const MAX_SUBTITLE_OFFSET_MS = 10 * 60 * 1000;

function readSaved(): Saved {
  try {
    const parsed: unknown = JSON.parse(profileStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

const EMPTY: VideoSubtitleState = { files: [], offsetMs: 0 };

interface LocalSubtitleStore {
  videos: Saved;
  addFile: (videoId: string, file: LocalSubtitleFile) => void;
  removeFile: (videoId: string, path: string) => void;
  setOffset: (videoId: string, offsetMs: number) => void;
}

export const useLocalSubtitleStore = create<LocalSubtitleStore>((set, get) => {
  const update = (videoId: string, change: (current: VideoSubtitleState) => VideoSubtitleState) => {
    const { [videoId]: current = EMPTY, ...others } = get().videos;
    const next = change(current);
    // Re-inserted last, so the entry dropped first is the one left alone longest.
    const entries = Object.entries(others);
    const kept = next.files.length > 0 || next.offsetMs !== 0 ? [...entries, [videoId, next] as const] : entries;
    const videos: Saved = Object.fromEntries(kept.slice(-MAX_VIDEOS));
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
    set({ videos });
  };
  return {
    videos: readSaved(),
    addFile: (videoId, file) =>
      update(videoId, (current) => ({
        ...current,
        files: [file, ...current.files.filter((known) => known.path !== file.path)],
      })),
    removeFile: (videoId, path) =>
      update(videoId, (current) => ({ ...current, files: current.files.filter((known) => known.path !== path) })),
    setOffset: (videoId, offsetMs) =>
      update(videoId, (current) => ({
        ...current,
        offsetMs: Math.min(MAX_SUBTITLE_OFFSET_MS, Math.max(-MAX_SUBTITLE_OFFSET_MS, offsetMs)),
      })),
  };
});

// Windows share this storage but no memory: a file added in one reaches the player in the other.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key?.endsWith(STORAGE_KEY)) useLocalSubtitleStore.setState({ videos: readSaved() });
  });
}

export const videoSubtitleState = (videos: Saved, videoId: string | null | undefined): VideoSubtitleState =>
  (videoId && videos[videoId]) || EMPTY;
