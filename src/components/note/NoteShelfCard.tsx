import { getString } from "../../lib/i18n/index";
import { formatYouTubeRelativeTime } from "../../lib/publishedDate";
import type { Note } from "../../lib/api/notes";
import { NoteImage, noteHeading } from "./NoteRow";

/** A note on the Library shelf: what was written comes first, then what it was written about. */
export function NoteShelfCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-44 w-[300px] shrink-0 snap-start flex-col gap-3 rounded-2xl bg-surface-row p-4 text-start transition-colors duration-200 ease-out hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="line-clamp-4 min-h-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-chrome-neutral-100">{note.text}</span>
      <span className="flex items-center gap-3">
        <NoteImage note={note} className={note.kind === "Channel" ? "w-9 shrink-0" : "w-16 shrink-0"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-chrome-neutral-200">{noteHeading(note)}</span>
          <span className="mt-0.5 block truncate text-xs text-chrome-neutral-500">
            {getString("note_edited", formatYouTubeRelativeTime(note.updatedAt))}
          </span>
        </span>
      </span>
    </button>
  );
}
