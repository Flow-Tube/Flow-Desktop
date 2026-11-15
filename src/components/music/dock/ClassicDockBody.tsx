import { Loader2, ListMusic, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { PlayOnButton } from "../../playon/PlayOnButton";
import { RemoteProgress } from "../../playon/RemoteProgress";
import { HapticButton } from "../HapticButton";
import { MusicScrubber } from "../MusicScrubber";
import { DockTrackInfo } from "./DockTrackInfo";
import type { DockModel } from "./dockModel";
import { GHOST, GHOST_IDLE } from "./dockStyles";

/** Classic: the wide bar Flow Desktop always had, with its fixed transport, actions and edge progress. */
export function ClassicDockBody({ model }: { model: DockModel }) {
  const { away, playing, busy, muted, eqActive, popover, setPopover, accentActive, volumeRef } = model;
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat, openOverlay } = useMusicPlayerStore.getState();

  return (
    <>
      <div className="flex w-1/3 min-w-0 items-center gap-3">
        <DockTrackInfo model={model} round={false} />
      </div>

      {/* CENTER — transport, left to right in every language like the timeline */}
      <div dir="ltr" className="flex w-1/3 items-center justify-center gap-5">
        {!away && (
          <HapticButton
            onClick={toggleShuffle}
            aria-label={getString("music_shuffle")}
            aria-pressed={isShuffle}
            className={isShuffle ? GHOST : GHOST_IDLE}
            style={isShuffle ? accentActive : undefined}
          >
            <Shuffle className="h-[18px] w-[18px]" />
          </HapticButton>
        )}

        <HapticButton
          onClick={previous}
          aria-label={getString("music_previous")}
          className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          <SkipBack className="h-5 w-5" fill="currentColor" />
        </HapticButton>

        <HapticButton
          onClick={togglePlay}
          aria-label={getString(playing ? "music_pause" : "music_play")}
          className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105 active:scale-90"
        >
          {busy ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : playing ? (
            <Pause className="h-7 w-7" fill="currentColor" />
          ) : (
            <Play className="h-7 w-7 translate-x-px" fill="currentColor" />
          )}
        </HapticButton>

        <HapticButton
          onClick={next}
          aria-label={getString("music_next")}
          className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-200 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          <SkipForward className="h-5 w-5" fill="currentColor" />
        </HapticButton>

        {!away && (
          <HapticButton
            onClick={cycleRepeat}
            aria-label={repeatMode === "one" ? getString("music_repeat_one") : getString("music_repeat")}
            aria-pressed={repeatMode !== "none"}
            className={repeatMode !== "none" ? GHOST : GHOST_IDLE}
            style={repeatMode !== "none" ? accentActive : undefined}
          >
            {repeatMode === "one" ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat className="h-[18px] w-[18px]" />}
          </HapticButton>
        )}
      </div>

      {/* RIGHT — secondary actions; the device controlled has its own. */}
      <div className="flex w-1/3 items-center justify-end gap-4">
        {!away && (
          <HapticButton
            ref={volumeRef}
            data-sheet-drag-ignore
            onClick={() => setPopover((p) => (p === "vol" ? null : "vol"))}
            aria-label={getString("music_volume")}
            aria-pressed={popover === "vol"}
            className={popover === "vol" ? `${GHOST} text-chrome-neutral-100` : GHOST_IDLE}
          >
            {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
          </HapticButton>
        )}

        <PlayOnButton className={GHOST_IDLE} />

        {!away && (
          <>
            <HapticButton onClick={() => openOverlay("queue")} aria-label={getString("music_queue")} className={GHOST_IDLE}>
              <ListMusic className="h-[18px] w-[18px]" />
            </HapticButton>

            <HapticButton onClick={() => openOverlay("lyrics")} aria-label={getString("music_lyrics")} className={GHOST_IDLE}>
              <Mic2 className="h-[18px] w-[18px]" />
            </HapticButton>

            <HapticButton
              onClick={() => setPopover((p) => (p === "eq" ? null : "eq"))}
              aria-label={getString("music_equalizer")}
              aria-pressed={popover === "eq"}
              className={popover === "eq" || eqActive ? GHOST : GHOST_IDLE}
              style={popover === "eq" || eqActive ? accentActive : undefined}
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" />
            </HapticButton>
          </>
        )}
      </div>

      {/* EDGE PROGRESS — pinned to the bottom of the bar */}
      {away ? (
        <RemoteProgress device={away} />
      ) : (
        <div data-sheet-drag-ignore className="absolute inset-x-0 bottom-0">
          <MusicScrubber variant="edge" />
        </div>
      )}
    </>
  );
}
