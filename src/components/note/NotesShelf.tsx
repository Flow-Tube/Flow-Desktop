import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { StickyNote } from "lucide-react";
import { LibraryShelf } from "../library/LibraryShelf";
import { NoteImage, noteHeading } from "./NoteRow";
import { getString } from "../../lib/i18n/index";
import { visibleNotes } from "../../lib/note/notesFiltering";
import { useNotesEnabled } from "../../lib/useNotes";
import { useNotesStore } from "../../store/useNotesStore";

const SHELF_SIZE = 12;

/** The Notes section of the Library: the latest edits. Goes with the notes switch in Settings. */
export function NotesShelf() {
  const enabled = useNotesEnabled();
  const navigate = useNavigate();
  const stored = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const notes = useMemo(
    () => visibleNotes(Object.values(stored), "", "all", "recent").slice(0, SHELF_SIZE),
    [stored],
  );
  if (!enabled) return null;
  return (
    <LibraryShelf
      title={getString("notes_title")}
      icon={StickyNote}
      viewAllTo="/notes"
      isEmpty={loaded && notes.length === 0}
      emptyLabel={getString("notes_empty_title")}
    >
      {notes.map((note) => (
        <button
          key={note.id}
          type="button"
          onClick={() => navigate("/notes", { state: { openNote: note.id } })}
          className="flex w-[280px] shrink-0 flex-col gap-2 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-3 text-left transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex items-center gap-2.5">
            <NoteImage note={note} className={note.kind === "Channel" ? "w-8 shrink-0" : "w-14 shrink-0"} />
            <span className="line-clamp-1 min-w-0 text-sm font-medium text-chrome-neutral-100">{noteHeading(note)}</span>
          </span>
          <span className="line-clamp-3 whitespace-pre-line text-sm text-chrome-neutral-400">{note.text}</span>
        </button>
      ))}
    </LibraryShelf>
  );
}
