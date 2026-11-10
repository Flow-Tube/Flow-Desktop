import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "../ui/Button";
import { NoteImage, noteHeading } from "./NoteRow";
import { getString } from "../../lib/i18n/index";
import type { Note } from "../../lib/api/notes";

const ARROW =
  "grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-30";

interface NotesReorderListProps {
  notes: Note[];
  onMove: (index: number, step: -1 | 1) => void;
  onDone: () => void;
}

/** Android drags these; here each row has arrows, which the keyboard can reach too. */
export function NotesReorderList({ notes, onMove, onDone }: NotesReorderListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-chrome-neutral-100">{getString("notes_reorder_title")}</h2>
        <Button onClick={onDone}>{getString("notes_done")}</Button>
      </div>
      <ul className="flex max-w-3xl flex-col gap-1">
        {notes.map((note, index) => (
          <li key={note.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-container">
            <NoteImage note={note} className={note.kind === "Channel" ? "w-9 shrink-0" : "w-16 shrink-0"} />
            <span className="min-w-0 flex-1 truncate text-sm text-chrome-neutral-100">{noteHeading(note)}</span>
            <button
              type="button"
              className={ARROW}
              disabled={index === 0}
              onClick={() => onMove(index, -1)}
              aria-label={getString("notes_move_up")}
              title={getString("notes_move_up")}
            >
              <ArrowUp size={18} />
            </button>
            <button
              type="button"
              className={ARROW}
              disabled={index === notes.length - 1}
              onClick={() => onMove(index, 1)}
              aria-label={getString("notes_move_down")}
              title={getString("notes_move_down")}
            >
              <ArrowDown size={18} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
