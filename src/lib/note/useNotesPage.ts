import { useCallback, useMemo, useState } from "react";
import { getPlural, getString } from "../i18n/index";
import { copyText } from "../clipboard";
import { useUiStore } from "../../store/useUiStore";
import { useNotesStore } from "../../store/useNotesStore";
import { SETTINGS } from "../settings/schema";
import { usePreference } from "../usePreference";
import { NOTES_SORTS, moved, shareText, visibleNotes, type NotesFilter, type NotesSort } from "./notesFiltering";
import { useNoteBackfill } from "./useNoteBackfill";
import type { Note } from "../api/notes";

const toSort = (value: string): NotesSort => NOTES_SORTS.find((sort) => sort === value) ?? "recent";

/** Everything the Notes page does: what it lists, what is selected, and the actions on them. */
export function useNotesPage() {
  const stored = useNotesStore((state) => state.notes);
  const loaded = useNotesStore((state) => state.loaded);
  const loadError = useNotesStore((state) => state.loadError);
  const load = useNotesStore((state) => state.load);
  const all = useMemo(() => Object.values(stored), [stored]);
  useNoteBackfill(all);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [sortValue, setSortValue] = usePreference(SETTINGS.NOTES_SORT, "recent");
  const sort = toSort(sortValue);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [reordering, setReordering] = useState(false);

  const visible = useMemo(() => visibleNotes(all, query, filter, sort), [all, query, filter, sort]);
  const openNote = openId ? stored[openId] : undefined;
  const selectedNotes = useMemo(() => visible.filter((note) => selected?.has(note.id)), [visible, selected]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const copy = async (notes: Note[], text: string) => {
    const copied = notes.length > 0 && (await copyText(text));
    useUiStore.getState().showToast({
      message: getString(copied ? "note_copied" : "note_copy_failed"),
      variant: copied ? "success" : "error",
    });
  };

  const remove = async (notes: Note[]) => {
    if (notes.length === 0) return;
    if (notes.some((note) => note.id === openId)) setOpenId(null);
    setSelected(null);
    await useNotesStore.getState().remove(notes.map((note) => note.id));
    if (notes.every((note) => !useNotesStore.getState().notes[note.id])) {
      useUiStore.getState().showToast({
        message: notes.length === 1 ? getString("note_deleted") : getPlural("notes_deleted", notes.length),
        actions: [{ label: getString("undo"), onSelect: () => void useNotesStore.getState().restore(notes) }],
      });
    }
  };

  /** Shows every note in the hand-made order, ready to be moved. */
  const startReordering = () => {
    setQuery("");
    setFilter("all");
    setSortValue("custom");
    setSelected(null);
    setOpenId(null);
    setReordering(true);
  };

  const move = (index: number, step: -1 | 1) => {
    const next = moved(visible, index, step);
    if (next !== visible) void useNotesStore.getState().saveOrder(next.map((note) => note.id));
  };

  return {
    all,
    visible,
    loaded,
    loadError,
    reload: load,
    query,
    setQuery,
    filter,
    setFilter,
    sort,
    setSort: (value: NotesSort) => setSortValue(value),
    openNote,
    setOpenId,
    selecting: selected !== null,
    selected,
    selectedNotes,
    startSelecting: () => setSelected(new Set()),
    stopSelecting: () => setSelected(null),
    selectAll: () => setSelected(new Set(visible.map((note) => note.id))),
    toggleSelected,
    copySelected: () => copy(selectedNotes, shareText(selectedNotes)),
    copyNote: (note: Note) => copy([note], note.text),
    remove,
    reordering,
    startReordering,
    stopReordering: () => setReordering(false),
    move,
  };
}
