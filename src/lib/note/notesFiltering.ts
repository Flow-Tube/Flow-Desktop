import { foldForSearch } from "../musicVideoMatching";
import { youtubeWatchUrl } from "../youtubeUrl";
import type { Note } from "../api/notes";

export const NOTES_FILTERS = ["all", "videos", "channels"] as const;
export type NotesFilter = (typeof NOTES_FILTERS)[number];

export const NOTES_SORTS = ["recent", "oldest", "title", "custom"] as const;
export type NotesSort = (typeof NOTES_SORTS)[number];

const noteTitle = (note: Note) => foldForSearch(note.title || note.text);

/** The notes the page shows: the chosen kind, matching every word of `query`, in `sort` order. */
export function visibleNotes(notes: Note[], query: string, filter: NotesFilter, sort: NotesSort): Note[] {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const matching = notes.filter((note) => {
    if (filter === "videos" && note.kind !== "Video") return false;
    if (filter === "channels" && note.kind !== "Channel") return false;
    const haystack = foldForSearch([note.text, note.title, note.channelName].filter(Boolean).join(" "));
    return words.every((word) => haystack.includes(word));
  });
  return [...matching].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return a.updatedAt - b.updatedAt;
      case "title":
        return noteTitle(a) < noteTitle(b) ? -1 : noteTitle(a) > noteTitle(b) ? 1 : 0;
      case "custom":
        // Notes never placed by hand follow, newest edit first.
        return (a.position ?? Infinity) - (b.position ?? Infinity) || b.updatedAt - a.updatedAt;
      default:
        return b.updatedAt - a.updatedAt;
    }
  });
}

/** `notes` as plain text to copy: each one's title and link, then the note itself. */
export function shareText(notes: Note[]): string {
  return notes
    .map((note) => {
      const link =
        note.kind === "Video"
          ? youtubeWatchUrl(note.targetId)
          : `https://www.youtube.com/channel/${note.targetId}`;
      return [note.title, link, note.text].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** `items` with the one at `index` moved by `step`, or the same list at either end. */
export function moved<T>(items: T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}
