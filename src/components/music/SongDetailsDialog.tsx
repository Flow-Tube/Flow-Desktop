import { useEffect } from "react";
import { Loader2, X } from "lucide-react";

import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { useSongDetails } from "../../lib/useSongDetails";
import { useSongDetailsStore } from "../../store/useSongDetailsStore";
import { useUiStore } from "../../store/useUiStore";

/** A song's details, each line copied by clicking it. */
export function SongDetailsDialog() {
  const song = useSongDetailsStore((state) => state.song);
  const close = useSongDetailsStore((state) => state.close);
  const showToast = useUiStore((state) => state.showToast);
  const { lines, loading } = useSongDetails(song);

  useEffect(() => {
    if (!song) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, song]);

  if (!song) return null;

  const copy = async (value: string) => {
    const copied = await copyText(value);
    showToast(copied
      ? { variant: "success", message: getString("selection_copied") }
      : { variant: "error", message: getString("selection_copy_failed") });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label={getString("music_details")}
        className="w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-bold text-chrome-neutral-100">
            {getString("music_details")}
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-chrome-neutral-500" /> : null}
          </h3>
          <button
            type="button"
            onClick={close}
            aria-label={getString("cancel")}
            className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} />
          </button>
        </div>
        <dl className="mt-3 flex flex-col">
          {lines.map((line) => (
            <button
              key={line.label}
              type="button"
              onClick={() => void copy(line.value)}
              aria-label={getString("music_details_copy", line.label)}
              className="flex flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <dt className="text-xs font-semibold text-chrome-neutral-500">{line.label}</dt>
              <dd className="break-words text-sm text-chrome-neutral-100">{line.value}</dd>
            </button>
          ))}
        </dl>
      </div>
    </div>
  );
}
