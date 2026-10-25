import { CheckCircle2, Loader2 } from "lucide-react";

import type { LyricsCandidate } from "../../../lib/lyrics/lyricsHelper";
import { getString } from "../../../lib/i18n/index";
import { LyricsDialog } from "./LyricsDialog";

const preview = (candidate: LyricsCandidate): string =>
  candidate.entries
    .map((e) => e.text.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");

/** Port of Android's LyricsSourcesSheet: every provider's result as it arrives, with a synced badge. */
export function LyricsSourcesDialog({
  candidates,
  isBrowsing,
  currentProviderName,
  onSelect,
  onClose,
}: {
  candidates: LyricsCandidate[];
  isBrowsing: boolean;
  currentProviderName: string;
  onSelect: (candidate: LyricsCandidate) => void;
  onClose: () => void;
}) {
  return (
    <LyricsDialog title={getString("lyrics_choose_source")} titleId="lyrics-sources-title" onClose={onClose}>
      {candidates.length === 0 ? (
        <div className="flex items-center gap-3.5 px-2 py-7 text-sm text-chrome-neutral-400">
          {isBrowsing && <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />}
          {getString(isBrowsing ? "lyrics_searching_sources" : "lyrics_no_sources_found")}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {candidates.map((candidate) => {
            const current = candidate.providerName === currentProviderName;
            return (
              <li key={candidate.providerName}>
                <button
                  type="button"
                  onClick={() => onSelect(candidate)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors duration-200 ease-out ${
                    current ? "bg-surface-container-highest" : "bg-surface-container-high hover:bg-surface-container-highest"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-chrome-neutral-100">{candidate.providerName}</span>
                      {candidate.synced && (
                        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">
                          {getString("lyrics_synced_badge")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-chrome-neutral-400">{preview(candidate)}</span>
                  </span>
                  {current && (
                    <CheckCircle2
                      className="h-5 w-5 shrink-0 text-[var(--color-primary)]"
                      aria-label={getString("lyrics_current_source", candidate.providerName)}
                    />
                  )}
                </button>
              </li>
            );
          })}
          {isBrowsing && (
            <li className="flex justify-center py-2.5">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
            </li>
          )}
        </ul>
      )}
    </LyricsDialog>
  );
}
