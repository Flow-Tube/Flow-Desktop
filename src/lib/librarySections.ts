import { useMemo } from "react";
import type { StringKey } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { usePreference } from "./usePreference";

/** The Library page's shelves, each of which can be hidden. The ids are stored, so they must never be renamed. */
export const LIBRARY_SECTIONS = [
  { id: "HISTORY", title: "library_history_label" },
  { id: "PLAYLISTS", title: "library_playlists_label" },
  { id: "ALBUMS", title: "albums_title" },
  { id: "SAVED_SHORTS", title: "library_saved_shorts_label" },
  { id: "WATCH_LATER", title: "library_watch_later_label" },
  { id: "LIKES", title: "library_likes_label" },
  { id: "VIDEO_DOWNLOADS", title: "library_video_downloads_label" },
  { id: "MUSIC_DOWNLOADS", title: "library_music_downloads_label" },
  { id: "NOTES", title: "notes_title" },
] as const satisfies readonly { id: string; title: StringKey }[];

export type LibrarySectionId = (typeof LIBRARY_SECTIONS)[number]["id"];

export function parseHiddenLibrarySections(raw: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function toggledHiddenSections(hidden: ReadonlySet<string>, id: LibrarySectionId, hide: boolean): string {
  const next = new Set(hidden);
  if (hide) next.add(id);
  else next.delete(id);
  return JSON.stringify([...next]);
}

/** Saved Shorts goes with the Show Shorts switch as well as its own. */
export function hiddenOnLibraryPage(hidden: ReadonlySet<string>, shortsEnabled: boolean): ReadonlySet<string> {
  return shortsEnabled ? hidden : new Set([...hidden, "SAVED_SHORTS"]);
}

export function useHiddenLibrarySections(): ReadonlySet<string> {
  const [raw] = usePreference(SETTINGS.HIDDEN_LIBRARY_SECTIONS);
  return useMemo(() => parseHiddenLibrarySections(raw), [raw]);
}
