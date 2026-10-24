import { useState } from "react";

import { getString } from "../../../lib/i18n/index";
import { LyricsDialog } from "./LyricsDialog";

/** Port of Android's LyricsEditDialog: the lyrics as LRC text, applied as the song's lyrics on save. */
export function LyricsEditDialog({
  initialText,
  onApply,
  onClose,
}: {
  initialText: string;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  return (
    <LyricsDialog
      title={getString("lyrics_edit")}
      titleId="lyrics-edit-title"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
          >
            {getString("cancel")}
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => {
              onApply(text);
              onClose();
            }}
            className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)] transition-opacity disabled:opacity-40"
          >
            {getString("save")}
          </button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        aria-label={getString("lyrics_edit")}
        className="h-80 w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-3 font-mono text-xs leading-relaxed text-chrome-neutral-200 outline-none focus:border-chrome-neutral-600"
      />
    </LyricsDialog>
  );
}
