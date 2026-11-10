import { parseViewCount } from "./playlistSort";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

// Flow for Android's flow-playlist format (data/playlist/PlaylistFile.kt): both apps read each other's files.

const FORMAT = "flow-playlist";
const VERSION = 1;
const MAX_FILE_NAME_LENGTH = 80;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;
/** Far above any real playlist, low enough that a wrong file can't exhaust memory. */
export const PLAYLIST_FILE_MAX_BYTES = 16 * 1024 * 1024;

// A shared file names its own pictures; only YouTube's hosts load, so one can't carry a tracking pixel.
const IMAGE_HOST = /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com|youtube\.com)$/i;

export interface PlaylistFileVideo {
  id: string;
  title?: string;
  channelName?: string;
  channelId?: string;
  channelThumbnailUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  viewCount?: number;
  uploadDate?: string;
  publishedAt?: number;
  description?: string;
  isMusic?: boolean;
  addedAt?: number | null;
}

export interface PlaylistFileContents {
  name: string;
  description: string;
  isMusic: boolean;
  videos: PlaylistFileVideo[];
}

export type PlaylistFileRead =
  | { kind: "read"; file: PlaylistFileContents }
  /** Not JSON, or JSON of some other kind. */
  | { kind: "notAPlaylist" }
  /** Written by a newer Flow in a format this one cannot read. */
  | { kind: "tooNew" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

/** Leaves out what's empty, as Android's writer does, so the two apps' files read alike. */
function withoutEmpty<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== "" && field !== 0 && field !== false && field != null),
  ) as T;
}

export function encodePlaylistFile(contents: PlaylistFileContents, exportedAt: number): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      exportedAt,
      playlist: withoutEmpty({ name: contents.name, description: contents.description, isMusic: contents.isMusic }),
      videos: contents.videos.filter((video) => VIDEO_ID_PATTERN.test(video.id)).map(withoutEmpty),
    },
    null,
    4,
  );
}

/** Reads a file's text, keeping only well-formed YouTube ids, each once. */
export function decodePlaylistFile(raw: string): PlaylistFileRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "notAPlaylist" };
  }
  if (
    !isRecord(parsed)
    || parsed.format !== FORMAT
    || typeof parsed.version !== "number"
    || !isRecord(parsed.playlist)
    || typeof parsed.playlist.name !== "string"
    || !Array.isArray(parsed.videos)
  ) {
    return { kind: "notAPlaylist" };
  }
  if (parsed.version > VERSION) return { kind: "tooNew" };

  const seen = new Set<string>();
  const videos: PlaylistFileVideo[] = [];
  for (const entry of parsed.videos) {
    if (!isRecord(entry) || typeof entry.id !== "string") return { kind: "notAPlaylist" };
    if (!VIDEO_ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    videos.push({
      id: entry.id,
      title: text(entry.title),
      channelName: text(entry.channelName),
      channelId: text(entry.channelId),
      channelThumbnailUrl: text(entry.channelThumbnailUrl),
      thumbnailUrl: text(entry.thumbnailUrl),
      durationSeconds: whole(entry.durationSeconds),
      viewCount: whole(entry.viewCount),
      uploadDate: text(entry.uploadDate),
      publishedAt: whole(entry.publishedAt),
      description: text(entry.description),
      isMusic: entry.isMusic === true,
      addedAt: typeof entry.addedAt === "number" && entry.addedAt > 0 ? entry.addedAt : null,
    });
  }
  return {
    kind: "read",
    file: {
      name: parsed.playlist.name,
      description: text(parsed.playlist.description),
      isMusic: parsed.playlist.isMusic === true,
      videos,
    },
  };
}

/** A name for the saved file that every file system accepts. */
export function playlistFileName(playlistName: string): string {
  const base = playlistName.replace(UNSAFE_FILE_NAME_CHARS, "_").trim().slice(0, MAX_FILE_NAME_LENGTH).trim();
  return `${base || FORMAT}.json`;
}

export function videoToFileEntry(video: VideoSummary): PlaylistFileVideo {
  return {
    id: video.id,
    title: video.title,
    channelName: video.channelName,
    channelId: video.channelId ?? "",
    channelThumbnailUrl: video.channelAvatarUrl ?? "",
    thumbnailUrl: video.thumbnailUrl ?? "",
    durationSeconds: video.durationSeconds ?? 0,
    viewCount: Math.round(video.viewCount ?? parseViewCount(video.viewCountText)),
    uploadDate: video.publishedText ?? "",
    publishedAt: video.publishedAt ?? 0,
    addedAt: video.addedAtInPlaylist ?? null,
  };
}

export function songToFileEntry(song: SongItem): PlaylistFileVideo {
  return {
    id: song.videoId ?? song.id,
    title: song.title,
    channelName: song.artists.map((artist) => artist.name).filter(Boolean).join(", "),
    channelId: song.artists[0]?.id ?? "",
    thumbnailUrl: song.thumbnail,
    durationSeconds: song.duration ?? 0,
    isMusic: true,
  };
}

const safeImage = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && IMAGE_HOST.test(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
};

const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function fileEntryToVideo(entry: PlaylistFileVideo): VideoSummary {
  return {
    id: entry.id,
    title: entry.title ?? "",
    channelName: entry.channelName ?? "",
    channelId: entry.channelId || null,
    channelAvatarUrl: safeImage(entry.channelThumbnailUrl),
    thumbnailUrl: safeImage(entry.thumbnailUrl) ?? youtubeThumbnail(entry.id),
    durationSeconds: entry.durationSeconds || null,
    publishedText: entry.uploadDate || null,
    publishedAt: entry.publishedAt || null,
    viewCount: entry.viewCount || null,
    addedAtInPlaylist: entry.addedAt ?? null,
  };
}

export function fileEntryToSong(entry: PlaylistFileVideo): SongItem {
  return {
    id: entry.id,
    title: entry.title ?? "",
    artists: entry.channelName ? [{ name: entry.channelName, id: entry.channelId || null }] : [],
    album: null,
    duration: entry.durationSeconds || null,
    musicVideoType: null,
    thumbnail: safeImage(entry.thumbnailUrl) ?? youtubeThumbnail(entry.id),
    explicit: false,
    videoId: entry.id,
    playlistId: null,
    params: null,
  };
}
