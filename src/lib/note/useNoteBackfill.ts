import { useEffect } from "react";
import { getChannelDetails, getVideoDetails } from "../api/youtube";
import { mapWithConcurrency } from "../concurrency";
import { useNotesStore } from "../../store/useNotesStore";
import type { Note, NoteSubject } from "../api/notes";

const PARALLEL_FETCHES = 3;
/** Once per note per run; a failure is tried again on the next run. */
const attempted = new Set<string>();

async function fetchSubject(note: Note): Promise<NoteSubject> {
  if (note.kind === "Channel") {
    const channel = await getChannelDetails(note.targetId);
    return {
      title: channel.name,
      channelId: channel.id,
      thumbnailUrl: channel.avatarUrl ?? "",
      channelAvatarUrl: channel.avatarUrl ?? "",
      channelHandle: channel.handle ?? "",
      subscriberCountText: channel.subscriberCountText ?? "",
    };
  }
  const video = await getVideoDetails(note.targetId);
  return {
    title: video.title,
    channelName: video.channelName ?? "",
    channelId: video.channelId ?? "",
    thumbnailUrl: video.thumbnailUrl ?? "",
    durationSeconds: video.durationSeconds ?? 0,
    channelAvatarUrl: video.channelAvatarUrl ?? "",
  };
}

/** Fills in what a note is about when it arrived without it, a few at a time. Failing is harmless. */
export async function fillMissingSubjects(notes: Note[]): Promise<void> {
  const missing = notes.filter((note) => !note.title && !attempted.has(note.id));
  for (const note of missing) attempted.add(note.id);
  await mapWithConcurrency(missing, PARALLEL_FETCHES, async (note) => {
    try {
      const subject = await fetchSubject(note);
      if (subject.title) await useNotesStore.getState().fillSubject(note, subject);
    } catch (error) {
      console.warn("Couldn't fill in a note's details", error);
    }
  });
}

export function useNoteBackfill(notes: Note[]): void {
  useEffect(() => {
    void fillMissingSubjects(notes);
  }, [notes]);
}

