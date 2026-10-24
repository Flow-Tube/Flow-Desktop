import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { HapticButton } from "../HapticButton";

export type SidePaneTab = "queue" | "lyrics";

interface PlayerSidePaneProps {
  tab: SidePaneTab;
  onTabChange: (tab: SidePaneTab) => void;
  onExpandLyrics: () => void;
  children: ReactNode;
}

const TAB = "rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 ease-out";

/**
 * The wide player's side pane, after Android's `PlayerSidePane`: Up next or
 * the lyrics beside the song, with a way to give the lyrics the whole player.
 */
export function PlayerSidePane({ tab, onTabChange, onExpandLyrics, children }: PlayerSidePaneProps) {
  const tabs: { id: SidePaneTab; label: string }[] = [
    { id: "queue", label: getString("music_up_next") },
    { id: "lyrics", label: getString("music_lyrics") },
  ];
  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div role="tablist" className="flex gap-1 rounded-full bg-surface-container p-1">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTabChange(id)}
              className={
                tab === id
                  ? `${TAB} bg-[var(--player-primary-container)] text-[var(--player-on-primary-container)]`
                  : `${TAB} text-chrome-neutral-300 hover:text-chrome-neutral-100`
              }
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "lyrics" && (
          <HapticButton
            onClick={onExpandLyrics}
            aria-label={getString("music_lyrics_full_player")}
            title={getString("music_lyrics_full_player")}
            className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <Maximize2 className="h-4 w-4" />
          </HapticButton>
        )}
      </div>
      <div role="tabpanel" className="relative min-h-0 flex-1 p-4">
        {children}
      </div>
    </aside>
  );
}
