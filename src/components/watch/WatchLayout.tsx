import { usePlayerStore } from "../../store/usePlayerStore";
import type { WatchLayoutProps } from "./types";

/*
  The sidebar only scrolls from `lg` up, and that is also the only place it
  clips: related cards bleed past their own box so their colour wash can grow.
  `lg:p-2` keeps that bleed inside the scroller's paint box.
*/
export function WatchLayout({ player, metadata, description, comments, sidebar }: WatchLayoutProps) {
  const isTheaterMode = usePlayerStore((s) => s.isTheaterMode);

  if (isTheaterMode) {
    return (
      <div className="min-h-screen bg-background pb-32 text-chrome-neutral-100">
        <div className="mx-auto grid w-full max-w-full grid-cols-1 items-start gap-x-6 gap-y-5 px-0 pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1100px)_400px_minmax(0,1fr)]">
          <div className="z-10 w-full bg-chrome-black lg:col-span-full lg:row-start-1">{player}</div>

          <div className="flex w-full min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
            {metadata}
            {description}
            {comments}
          </div>

          <div className="flex w-full min-h-0 flex-col gap-5 overscroll-contain lg:sticky lg:top-6 lg:col-start-3 lg:row-start-2 lg:max-h-[calc(100vh-6.5rem)] lg:self-start lg:overflow-y-auto lg:p-2 hide-scrollbar">
            {sidebar}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32 text-chrome-neutral-100">
      <div className="mx-auto grid w-full max-w-[1800px] grid-cols-1 items-start gap-x-6 gap-y-5 px-4 pt-4 md:px-6 md:pt-6 lg:grid-cols-[1fr_400px]">
        <div className="flex w-full min-w-0 flex-col gap-5">
          {player}
          {metadata}
          {description}
          {comments}
        </div>

        <div className="flex w-full min-h-0 flex-col gap-5 overscroll-contain lg:sticky lg:top-6 lg:max-h-[calc(100vh-6.5rem)] lg:self-start lg:overflow-y-auto lg:p-2 hide-scrollbar">
          {sidebar}
        </div>
      </div>
    </div>
  );
}
