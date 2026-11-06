import { create } from "zustand";
import {
  deleteNotes,
  listNotes,
  noteId,
  restoreNotes,
  saveNote,
  saveNotesOrder,
  saveNoteSubject,
  type Note,
  type NoteKind,
  type NoteSubject,
} from "../lib/api/notes";
import { getString } from "../lib/i18n/index";
import { useUiStore } from "./useUiStore";

/** What the note editor is open on. */
export interface NoteEditorTarget {
  kind: NoteKind;
  targetId: string;
  subject: NoteSubject | null;
  /** The playing position a chip can write into the note; absent where there is none. */
  insertAtSeconds?: number;
}

interface NotesState {
  notes: Record<string, Note>;
  loaded: boolean;
  loadError: boolean;
  editor: NoteEditorTarget | null;
  /** Whether this window shows the editor; the pop-out player doesn't. */
  editorHosted: boolean;
  load: () => Promise<void>;
  save: (kind: NoteKind, targetId: string, text: string, subject: NoteSubject | null) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  restore: (notes: Note[]) => Promise<void>;
  saveOrder: (ids: string[]) => Promise<void>;
  fillSubject: (note: Note, subject: NoteSubject) => Promise<void>;
  openEditor: (target: NoteEditorTarget) => void;
  closeEditor: () => void;
}

const byId = (notes: Note[]): Record<string, Note> => Object.fromEntries(notes.map((note) => [note.id, note]));

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: {},
  loaded: false,
  loadError: false,
  editor: null,
  editorHosted: false,
  load: async () => {
    try {
      set({ notes: byId(await listNotes()), loaded: true, loadError: false });
    } catch (error) {
      console.warn("Failed to load notes", error);
      set({ loaded: true, loadError: true });
    }
  },
  save: async (kind, targetId, text, subject) => {
    const id = noteId(kind, targetId);
    const before = get().notes;
    const trimmed = text.trim();
    const { [id]: stored, ...others } = before;
    set({
      notes: trimmed
        ? {
            ...before,
            [id]: { ...stored, ...subject, id, kind, targetId, text: trimmed, updatedAt: Date.now() },
          }
        : others,
    });
    try {
      const saved = await saveNote(kind, targetId, text, subject);
      if (saved) set((state) => ({ notes: { ...state.notes, [id]: saved } }));
    } catch (error) {
      console.warn("Failed to save note", error);
      set({ notes: before });
      useUiStore.getState().showToast({ message: getString("note_save_failed"), variant: "error" });
    }
  },
  remove: async (ids) => {
    const before = get().notes;
    const kept = { ...before };
    for (const id of ids) delete kept[id];
    set({ notes: kept });
    try {
      await deleteNotes(ids);
    } catch (error) {
      console.warn("Failed to delete notes", error);
      set({ notes: before });
      useUiStore.getState().showToast({ message: getString("note_delete_failed"), variant: "error" });
    }
  },
  restore: async (notes) => {
    const before = get().notes;
    set({ notes: { ...before, ...byId(notes) } });
    try {
      const restored = await restoreNotes(notes);
      set((state) => ({ notes: { ...state.notes, ...byId(restored) } }));
    } catch (error) {
      console.warn("Failed to restore notes", error);
      set({ notes: before });
      useUiStore.getState().showToast({ message: getString("note_save_failed"), variant: "error" });
    }
  },
  saveOrder: async (ids) => {
    const before = get().notes;
    const placed = { ...before };
    ids.forEach((id, position) => {
      const note = placed[id];
      if (note) placed[id] = { ...note, position };
    });
    set({ notes: placed });
    try {
      await saveNotesOrder(ids);
    } catch (error) {
      console.warn("Failed to save the order of notes", error);
      set({ notes: before });
      useUiStore.getState().showToast({ message: getString("note_save_failed"), variant: "error" });
    }
  },
  fillSubject: async (note, subject) => {
    await saveNoteSubject(note.kind, note.targetId, subject);
    set((state) => {
      const current = state.notes[note.id];
      return current ? { notes: { ...state.notes, [note.id]: { ...current, ...subject } } } : {};
    });
  },
  openEditor: (editor) => set({ editor }),
  closeEditor: () => set({ editor: null }),
}));
