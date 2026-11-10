import { useCallback } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "../ui/Button";
import { NoteCard } from "./NoteCard";
import { getString } from "../../lib/i18n/index";
import { seekToTime } from "../../lib/playerSeek";
import { useNote, useNotesEnabled } from "../../lib/useNotes";
import { useNotesStore } from "../../store/useNotesStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { NoteSubject } from "../../lib/api/notes";
import type { VideoDetails, VideoSummary } from "../../types/video";

function subjectOf(video: VideoSummary, details: VideoDetails | null): NoteSubject | null {
  const title = details?.title || video.title;
  if (!title) return null;
  return {
    title,
    channelName: details?.channelName || video.channelName || "",
    channelId: details?.channelId || video.channelId || "",
    thumbnailUrl: details?.thumbnailUrl || video.thumbnailUrl || "",
    durationSeconds: details?.durationSeconds ?? video.durationSeconds ?? 0,
    channelAvatarUrl: details?.channelAvatarUrl || video.channelAvatarUrl || "",
  };
}

/** Opens the editor on the playing video, with its position ready to write in unless it is live. */
function useOpenVideoNote(video: VideoSummary | null, details: VideoDetails | null = null): () => void {
  return useCallback(() => {
    if (!video) return;
    const { currentTime } = usePlayerStore.getState();
    useNotesStore.getState().openEditor({
      kind: "Video",
      targetId: video.id,
      subject: subjectOf(video, details),
      insertAtSeconds: details?.isLive || video.isLive ? undefined : currentTime,
    });
  }, [video, details]);
}

interface WatchNoteProps {
  video: VideoSummary;
  videoData: VideoDetails | null;
}

export function WatchNoteButton({ video, videoData }: WatchNoteProps) {
  const enabled = useNotesEnabled("Video");
  const note = useNote("Video", video.id);
  const open = useOpenVideoNote(video, videoData);
  if (!enabled) return null;
  return (
    <Button variant="tonal" onClick={open} aria-label={getString(note ? "note_edit" : "note_add")} aria-pressed={!!note}>
      <StickyNote size={18} fill={note ? "currentColor" : "none"} />
      {getString("note_title")}
    </Button>
  );
}

/** The video's note, under its details. Nothing while there is none: the button adds one. */
export function WatchNote({ video, videoData }: WatchNoteProps) {
  const enabled = useNotesEnabled("Video");
  const note = useNote("Video", video.id);
  const open = useOpenVideoNote(video, videoData);
  if (!enabled || !note) return null;
  return (
    <NoteCard
      text={note.text}
      onEdit={open}
      durationSeconds={videoData?.durationSeconds ?? video.durationSeconds ?? 0}
      onSeek={seekToTime}
    />
  );
}
