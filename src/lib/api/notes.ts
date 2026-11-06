import { invokeBackend } from "./errors";

export type NoteKind = "Video" | "Channel";

/** What a note is about, saved with it so the Notes page needs no network. */
export interface NoteSubject {
  title?: string | null;
  channelName?: string | null;
  channelId?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  channelAvatarUrl?: string | null;
  channelHandle?: string | null;
  subscriberCountText?: string | null;
}

export interface Note extends NoteSubject {
  id: string;
  targetId: string;
  kind: NoteKind;
  text: string;
  updatedAt: number;
  /** Where the viewer placed it by hand; null until they reorder. */
  position?: number | null;
}

export const noteId = (kind: NoteKind, targetId: string): string => `${kind.toLowerCase()}:${targetId}`;

export const listNotes = (): Promise<Note[]> => invokeBackend<Note[]>("list_notes");

/** Resolves to the saved note, or null when blank text deleted it. */
export const saveNote = (
  kind: NoteKind,
  targetId: string,
  text: string,
  subject: NoteSubject | null,
): Promise<Note | null> => invokeBackend<Note | null>("save_note", { kind, targetId, text, subject });

export const deleteNotes = (ids: string[]): Promise<void> => invokeBackend<void>("delete_notes", { ids });
