import { FilePlus2, X } from "lucide-react";
import { PIP_WINDOW_LABEL } from "../../lib/api/pip";
import { CURRENT_WINDOW_LABEL } from "../../lib/appWindow";
import { getString } from "../../lib/i18n/index";
import { usePickSubtitleFile } from "../../lib/localSubtitles";
import {
  useLocalSubtitleStore,
  videoSubtitleState,
} from "../../store/useLocalSubtitleStore";
import { usePlayerStore } from "../../store/usePlayerStore";

const STEPS_MS = [-1000, -100, 100, 1000];

function secondsLabel(ms: number): string {
  return (Math.abs(ms) / 1000).toFixed(Math.abs(ms) % 100 === 0 ? 1 : 2);
}

function timingLabel(offsetMs: number): string {
  if (offsetMs > 0) return getString("subtitle_timing_later", secondsLabel(offsetMs));
  if (offsetMs < 0) return getString("subtitle_timing_earlier", secondsLabel(offsetMs));
  return getString("subtitle_timing_in_sync");
}

/** Moves captions against the picture, for a file made for another cut: later or earlier. */
export function SubtitleTimingRow() {
  const videoId = usePlayerStore((s) => s.currentVideo?.id ?? null);
  const offsetMs = useLocalSubtitleStore((s) => videoSubtitleState(s.videos, videoId).offsetMs);
  const setOffset = useLocalSubtitleStore((s) => s.setOffset);
  if (!videoId) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-medium text-chrome-zinc-100">{getString("subtitle_timing")}</span>
          <span className="block text-xs tabular-nums text-chrome-zinc-400">{timingLabel(offsetMs)}</span>
        </span>
        {offsetMs !== 0 && (
          <button
            type="button"
            onClick={() => setOffset(videoId, 0)}
            className="rounded-md px-2 py-1 text-xs font-semibold text-chrome-zinc-200 transition-colors duration-200 ease-out hover:bg-chrome-white/10"
          >
            {getString("subtitle_timing_reset")}
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {STEPS_MS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => setOffset(videoId, offsetMs + step)}
            className="rounded-md bg-chrome-white/10 py-1.5 text-xs font-semibold tabular-nums text-chrome-zinc-100 transition-colors duration-200 ease-out hover:bg-chrome-white/15"
          >
            {getString("subtitle_timing_step", `${step < 0 ? "−" : "+"}${Math.abs(step) / 1000}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AddSubtitleFileRow({ rowClass }: { rowClass: string }) {
  const videoId = usePlayerStore((s) => s.currentVideo?.id ?? null);
  const pick = usePickSubtitleFile(videoId);
  // The pop-out has no file dialog permission, so the row could only do nothing there.
  if (CURRENT_WINDOW_LABEL === PIP_WINDOW_LABEL) return null;
  return (
    <button type="button" onClick={() => void pick()} title={getString("subtitle_file_drop_hint")} className={rowClass}>
      <span>{getString("subtitle_file_add")}</span>
      <FilePlus2 size={16} className="shrink-0 text-chrome-zinc-400" />
    </button>
  );
}

export function RemoveSubtitleFileButton({ path }: { path: string }) {
  const videoId = usePlayerStore((s) => s.currentVideo?.id ?? null);
  const removeFile = useLocalSubtitleStore((s) => s.removeFile);
  if (!videoId) return null;
  return (
    <button
      type="button"
      aria-label={getString("subtitle_file_remove")}
      title={getString("subtitle_file_remove")}
      onClick={() => removeFile(videoId, path)}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-chrome-zinc-400 transition-colors duration-200 ease-out hover:bg-chrome-white/10 hover:text-chrome-white"
    >
      <X size={14} />
    </button>
  );
}
