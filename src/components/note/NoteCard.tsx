import { useMemo, useState } from "react";
import { PenLine, StickyNote } from "lucide-react";
import { RichText } from "../ui/RichText";
import { getString } from "../../lib/i18n/index";
import { hasTextSelection } from "../../lib/textSelection";
import { noteRichText } from "../../lib/note/noteMoments";
import type { RichTarget } from "../../types/video";

const noImages = () => "";

interface NoteCardProps {
  text: string;
  onEdit: () => void;
  durationSeconds?: number;
  /** Without it the times in the note stay plain text. */
  onSeek?: (seconds: number) => void;
}

/** A note the user wrote, compact until clicked. The same card on the Watch and Channel pages. */
export function NoteCard({ text, onEdit, durationSeconds = 0, onSeek }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rich = useMemo(
    () => (onSeek ? noteRichText(text, durationSeconds) : { text, spans: [], emojis: [] }),
    [text, durationSeconds, onSeek],
  );
  const activate = (target: RichTarget) => {
    if (target.kind === "timestamp") onSeek?.(target.seconds);
  };

  return (
    <div
      onClick={() => {
        if (!hasTextSelection()) setExpanded((value) => !value);
      }}
      className="cursor-pointer rounded-xl bg-surface-container-low p-4 text-sm transition-colors duration-200 ease-out hover:bg-surface-container"
    >
      <div className="flex items-center gap-2 font-medium text-chrome-neutral-200">
        <StickyNote size={16} className="shrink-0 text-chrome-neutral-400" />
        <span className="flex-1">{getString("note_title")}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          aria-label={getString("note_edit")}
          title={getString("note_edit")}
          className="grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <PenLine size={16} />
        </button>
      </div>
      <div className={`mt-1 select-text text-chrome-neutral-300 ${expanded ? "" : "line-clamp-3"}`}>
        <RichText value={rich} onActivate={activate} imageSrc={noImages} />
      </div>
    </div>
  );
}
