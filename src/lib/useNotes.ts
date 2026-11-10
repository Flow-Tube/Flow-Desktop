import { noteId, type Note, type NoteKind } from "./api/notes";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useNotesStore } from "../store/useNotesStore";

export function useNote(kind: NoteKind, targetId: string): Note | undefined {
  return useNotesStore((state) => state.notes[noteId(kind, targetId)]);
}

/** The surface switches count only while the master switch is on. */
export function useNotesEnabled(surface?: NoteKind): boolean {
  return useAppSettingsStore((state) => {
    if (state.values[SETTINGS.NOTES_ENABLED] === "false") return false;
    if (surface === "Video") return state.values[SETTINGS.VIDEO_NOTES_ENABLED] !== "false";
    if (surface === "Channel") return state.values[SETTINGS.CHANNEL_NOTES_ENABLED] !== "false";
    return true;
  });
}
