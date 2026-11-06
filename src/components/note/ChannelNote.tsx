import { useCallback } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "../ui/Button";
import { NoteCard } from "./NoteCard";
import { getString } from "../../lib/i18n/index";
import { useNote, useNotesEnabled } from "../../lib/useNotes";
import { useNotesStore } from "../../store/useNotesStore";
import type { ChannelDetails } from "../../types/video";

function useOpenChannelNote(channel: ChannelDetails): () => void {
  return useCallback(() => {
    useNotesStore.getState().openEditor({
      kind: "Channel",
      targetId: channel.id,
      subject: {
        title: channel.name,
        channelId: channel.id,
        thumbnailUrl: channel.avatarUrl ?? "",
        channelAvatarUrl: channel.avatarUrl ?? "",
        channelHandle: channel.handle ?? "",
        subscriberCountText: channel.subscriberCountText ?? "",
      },
    });
  }, [channel]);
}

export function ChannelNoteButton({ channelInfo }: { channelInfo: ChannelDetails }) {
  const enabled = useNotesEnabled("Channel");
  const note = useNote("Channel", channelInfo.id);
  const open = useOpenChannelNote(channelInfo);
  if (!enabled) return null;
  return (
    <Button variant="tonal" onClick={open} aria-label={getString(note ? "note_edit" : "note_add")} aria-pressed={!!note}>
      <StickyNote size={18} fill={note ? "currentColor" : "none"} />
      {getString("note_title")}
    </Button>
  );
}

export function ChannelNote({ channelInfo }: { channelInfo: ChannelDetails }) {
  const enabled = useNotesEnabled("Channel");
  const note = useNote("Channel", channelInfo.id);
  const open = useOpenChannelNote(channelInfo);
  if (!enabled || !note) return null;
  return (
    <div className="mb-6 max-w-3xl">
      <NoteCard text={note.text} onEdit={open} />
    </div>
  );
}
