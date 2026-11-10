import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { StickyNote } from "lucide-react";
import { LibraryShelf } from "../library/LibraryShelf";
import { NoteShelfCard } from "./NoteShelfCard";
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
        <NoteShelfCard key={note.id} note={note} onOpen={() => navigate("/notes", { state: { openNote: note.id } })} />
      ))}
    </LibraryShelf>
  );
}
