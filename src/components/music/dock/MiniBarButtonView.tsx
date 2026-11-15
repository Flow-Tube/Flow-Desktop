import { useEffect, type CSSProperties, type Ref } from "react";
import {
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { isLocalMediaId } from "../../../lib/localMediaId";
import { upcomingIndex } from "../../../lib/musicQueueOrder";
import { miniBarButtonLabel, type MiniBarButton } from "../../../lib/music/miniPlayerLook";
import { toggleSongLikeWithToast } from "../../../lib/songLikeToast";
import { useAlbumLibraryStore } from "../../../store/useAlbumLibraryStore";
import { useLikesStore } from "../../../store/useLikesStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import type { SongItem } from "../../../types/music";
import { PlayOnButton } from "../../playon/PlayOnButton";
import { HapticButton } from "../HapticButton";
import { MusicSleepTimerButton } from "../MusicSleepTimerButton";
import { GHOST, GHOST_IDLE } from "./dockStyles";

const SKIP_SECONDS = 10;
const ICON = "h-[18px] w-[18px]";

export interface MiniBarButtonContext {
  track: SongItem | null;
  playing: boolean;
  busy: boolean;
  muted: boolean;
  eqActive: boolean;
  popover: null | "eq" | "vol";
  setPopover: (update: (current: null | "eq" | "vol") => null | "eq" | "vol") => void;
  accentActive: CSSProperties;
  volumeRef: Ref<HTMLButtonElement>;
}

function LikeButton({ track }: { track: SongItem }) {
  const liked = useLikesStore((s) => s.isLikedSong(track));
  const loaded = useLikesStore((s) => s.loaded);
  const load = useLikesStore((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return (
    <HapticButton
      onClick={() => void toggleSongLikeWithToast(track, liked)}
      aria-label={getString("music_like")}
      aria-pressed={liked}
      className={liked ? `${GHOST} text-[var(--color-primary)]` : GHOST_IDLE}
    >
      <Heart className={ICON} fill={liked ? "currentColor" : "none"} />
    </HapticButton>
  );
}

/** A skip of ten seconds: the turn arrow with its count inside. */
function SkipIcon({ forward }: { forward: boolean }) {
  const Arrow = forward ? RotateCw : RotateCcw;
  return (
    <span className="relative grid place-items-center">
      <Arrow className="h-5 w-5" />
      <span className="absolute text-[7px] font-bold leading-none">{SKIP_SECONDS}</span>
    </span>
  );
}

/** One of the buttons the user put in the pill mini player. */
export function MiniBarButtonView({ button, ctx }: { button: MiniBarButton; ctx: MiniBarButtonContext }) {
  const store = useMusicPlayerStore.getState;
  const isShuffle = useMusicPlayerStore((s) => s.isShuffle);
  const repeatMode = useMusicPlayerStore((s) => s.repeatMode);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const label = miniBarButtonLabel(button);
  const nextTitle = useMusicPlayerStore((s) => (button === "next" ? (s.queue[upcomingIndex(s)]?.title ?? null) : null));
  const plain = (icon: React.ReactNode, onClick: () => void, ariaLabel = label, title?: string) => (
    <HapticButton onClick={onClick} aria-label={ariaLabel} title={title} className={GHOST_IDLE}>
      {icon}
    </HapticButton>
  );

  switch (button) {
    case "play_pause":
      return (
        <HapticButton
          onClick={() => store().togglePlay()}
          aria-label={getString(ctx.playing ? "music_pause" : "music_play")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] transition-transform duration-200 ease-out hover:scale-105 active:scale-90"
        >
          {ctx.busy ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : ctx.playing ? (
            <Pause className="h-6 w-6" fill="currentColor" />
          ) : (
            <Play className="h-6 w-6 translate-x-px" fill="currentColor" />
          )}
        </HapticButton>
      );
    case "previous":
      return plain(<SkipBack className="h-5 w-5" fill="currentColor" />, () => store().previous(), getString("music_previous"));
    case "next":
      return plain(
        <SkipForward className="h-5 w-5" fill="currentColor" />,
        () => store().next(),
        getString("music_next"),
        nextTitle ? `${getString("music_up_next")}: ${nextTitle}` : undefined,
      );
    case "like":
      return ctx.track && !isLocalMediaId(ctx.track.videoId ?? ctx.track.id) ? <LikeButton track={ctx.track} /> : null;
    case "add_to_playlist":
      return ctx.track ? plain(<ListPlus className={ICON} />, () => openAddToAlbum(ctx.track!), getString("music_add_to_album")) : null;
    case "shuffle":
      return (
        <HapticButton
          onClick={() => store().toggleShuffle()}
          aria-label={getString("music_shuffle")}
          aria-pressed={isShuffle}
          className={isShuffle ? GHOST : GHOST_IDLE}
          style={isShuffle ? ctx.accentActive : undefined}
        >
          <Shuffle className={ICON} />
        </HapticButton>
      );
    case "repeat":
      return (
        <HapticButton
          onClick={() => store().cycleRepeat()}
          aria-label={getString(repeatMode === "one" ? "music_repeat_one" : "music_repeat")}
          aria-pressed={repeatMode !== "none"}
          className={repeatMode !== "none" ? GHOST : GHOST_IDLE}
          style={repeatMode !== "none" ? ctx.accentActive : undefined}
        >
          {repeatMode === "one" ? <Repeat1 className={ICON} /> : <Repeat className={ICON} />}
        </HapticButton>
      );
    case "queue":
      return plain(<ListMusic className={ICON} />, () => store().openOverlay("queue"), getString("music_queue"));
    case "lyrics":
      return plain(<Mic2 className={ICON} />, () => store().openOverlay("lyrics"), getString("music_lyrics"));
    case "sleep_timer":
      return <MusicSleepTimerButton always className={GHOST_IDLE} activeClassName={`${GHOST} text-[var(--color-primary)]`} iconClassName={ICON} />;
    case "back_10":
      return plain(<SkipIcon forward={false} />, () => store().seek(Math.max(0, store().progress - SKIP_SECONDS)));
    case "forward_10":
      return plain(<SkipIcon forward />, () => {
        const { progress, duration, seek } = store();
        seek(duration > 0 ? Math.min(duration, progress + SKIP_SECONDS) : progress + SKIP_SECONDS);
      });
    case "volume":
      return (
        <HapticButton
          ref={ctx.volumeRef}
          data-sheet-drag-ignore
          onClick={() => ctx.setPopover((p) => (p === "vol" ? null : "vol"))}
          aria-label={getString("music_volume")}
          aria-pressed={ctx.popover === "vol"}
          className={ctx.popover === "vol" ? `${GHOST} text-chrome-neutral-100` : GHOST_IDLE}
        >
          {ctx.muted ? <VolumeX className={ICON} /> : <Volume2 className={ICON} />}
        </HapticButton>
      );
    case "equalizer": {
      const on = ctx.popover === "eq" || ctx.eqActive;
      return (
        <HapticButton
          onClick={() => ctx.setPopover((p) => (p === "eq" ? null : "eq"))}
          aria-label={getString("music_equalizer")}
          aria-pressed={ctx.popover === "eq"}
          className={on ? GHOST : GHOST_IDLE}
          style={on ? ctx.accentActive : undefined}
        >
          <SlidersHorizontal className={ICON} />
        </HapticButton>
      );
    }
    case "play_on":
      return <PlayOnButton className={GHOST_IDLE} />;
    case "close":
      return plain(<X className={ICON} />, () => store().dismiss(), getString("music_dismiss"));
  }
}
