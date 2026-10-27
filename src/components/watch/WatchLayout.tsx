import { useRef } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { usePageEnterMotion } from "../../lib/usePageEnterMotion";
import type { WatchLayoutProps } from "./types";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/*
  One tree for both layouts, with only classes changing: switching to theater mode
  used to swap trees, which remounted comments, live chat and the side panels and
  made them load again. The second row is `1fr` so a tall sidebar spanning both rows
  never opens a gap under the player.

  The sidebar only scrolls from `lg` up, and that is also the only place it
  clips: related cards bleed past their own box so their colour wash can grow.
  `lg:p-2` keeps that bleed inside the scroller's paint box.
*/
export function WatchLayout({ player, metadata, description, comments, sidebar }: WatchLayoutProps) {
  const isTheaterMode = usePlayerStore((s) => s.isTheaterMode);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  // The player glides to its new box; what moved under it fades in at its new place.
  const layoutKey = isTheaterMode ? "theater" : "default";
  usePageEnterMotion(mainRef, layoutKey, false);
  usePageEnterMotion(sideRef, layoutKey, false);

  return (
    <div className="min-h-screen bg-background pb-32 text-chrome-neutral-100">
      <div
        className={cx(
          "mx-auto grid w-full grid-cols-1 items-start gap-x-6 gap-y-5 lg:grid-rows-[auto_1fr]",
          isTheaterMode
            ? "max-w-full px-0 pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1100px)_400px_minmax(0,1fr)]"
            : "max-w-[1800px] px-4 pt-4 md:px-6 md:pt-6 lg:grid-cols-[1fr_400px]",
        )}
      >
        <div
          className={cx(
            "w-full min-w-0 lg:row-start-1",
            isTheaterMode ? "z-10 bg-chrome-black lg:col-span-full" : "lg:col-start-1",
          )}
        >
          {player}
        </div>

        <div
          ref={mainRef}
          className={cx(
            "flex w-full min-w-0 flex-col gap-5 lg:row-start-2",
            isTheaterMode ? "lg:col-start-2" : "lg:col-start-1",
          )}
        >
          {metadata}
          {description}
          {comments}
        </div>

        <div
          ref={sideRef}
          className={cx(
            "flex w-full min-h-0 flex-col gap-5 overscroll-contain lg:sticky lg:top-6 lg:max-h-[calc(100vh-6.5rem)] lg:self-start lg:overflow-y-auto lg:p-2 hide-scrollbar",
            isTheaterMode ? "lg:col-start-3 lg:row-start-2" : "lg:col-start-2 lg:row-span-2 lg:row-start-1",
          )}
        >
          {sidebar}
        </div>
      </div>
    </div>
  );
}
