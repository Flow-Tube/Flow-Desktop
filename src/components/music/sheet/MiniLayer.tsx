import { useState, type CSSProperties } from "react";
import { X } from "lucide-react";

import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { useMusicPlayerError } from "../../../lib/useMusicPlayerError";
import { getString } from "../../../lib/i18n/index";
import { artistsText } from "../../../lib/musicFormat";
import { PlayerErrorState } from "../../ui/PlayerErrorState";
import { HapticButton } from "../HapticButton";
import { useMusicContextMenu } from "../MusicCardMenu";
import { useNowPlayingMenuActions } from "../useNowPlayingMenuActions";
import { EqPanel } from "../EqPanel";
import { useEqActive } from "../../../lib/audio/eq/useEqualizer";
import { VolumePopover } from "../VolumePopover";
import { useArtworkSwatches } from "../../../lib/useArtworkSwatches";
import { useDockControlColors, useDockToggleColors } from "../../../lib/usePlayerColors";
import { useMusicWheelVolume } from "../../../lib/useMusicWheelVolume";
import { useVolumeFeedback } from "../../../lib/useVolumeFeedback";
import { VolumeFeedbackPill } from "../../ui/VolumeFeedbackPill";
import { upgradeMusicImageUrl, youtubeThumbnailUrl } from "../../../lib/thumbnails";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import { useSheetDrag } from "../../../lib/useSheetDrag";
import { useControlledDevice, useRemoteActive } from "../../../lib/live/usePlayOn";
import { useMiniPlayerLook } from "../../../lib/music/miniPlayerLook";
import { useMiniBarSurface } from "../../../lib/music/miniBarSurface";
import { useLyricsCover } from "../../../lib/lyrics/useLyricsCover";
import { LyricsCoverBackground } from "../lyrics/LyricsCoverBackground";
import { ClassicDockBody } from "../dock/ClassicDockBody";
import { PillDockBody } from "../dock/PillDockBody";
import type { DockModel } from "../dock/dockModel";

/** The Pill's widths, never wider than 90% of the window. */
const PILL_WIDTH = {
  compact: "w-[min(90%,36rem)]",
  regular: "w-[min(90%,44rem)]",
  wide: "w-[min(90%,56rem)]",
} as const;

/** Everything the mini player shows and the state its bar and its popovers share. */
export function useMiniPlayer() {
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const viewState = useMusicPlayerStore((s) => s.viewState);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const isBuffering = useMusicPlayerStore((s) => s.isBuffering);
  const loadingStreamId = useMusicPlayerStore((s) => s.loadingStreamId);
  const eqEnabled = useEqActive();
  const isMuted = useMusicPlayerStore((s) => s.isMuted);
  const volume = useMusicPlayerStore((s) => s.volume);
  const { feedback: volumeFeedback, show: showVolumeFeedback } = useVolumeFeedback();
  const volumeWheelRef = useMusicWheelVolume<HTMLButtonElement>({ onFeedback: showVolumeFeedback });
  const look = useMiniPlayerLook();
  const pill = look.style === "pill";
  const error = useMusicPlayerError();
  const [popover, setPopover] = useState<null | "eq" | "vol">(null);
  const [hovered, setHovered] = useState(false);
  const menu = useMusicContextMenu(Boolean(currentTrack));
  const menuActions = useNowPlayingMenuActions(currentTrack);

  // Same artwork URL the full player samples, so this reads a warm cache entry.
  const accentSrc = useProxiedImageUrl(upgradeMusicImageUrl(currentTrack?.thumbnail));
  const swatches = useArtworkSwatches(accentSrc);
  const accentActive = useDockToggleColors(swatches);
  const controlColors = useDockControlColors(swatches);
  const surface = useMiniBarSurface(look.background, swatches);
  const cover = useLyricsCover(accentSrc, surface.coverColors);

  // While this device controls another, the bar shows that device's music and its buttons drive
  // it (the player's actions go there); a video there gets the remote dock instead.
  const remote = useRemoteActive();
  const controlled = useControlledDevice();
  const away = remote && controlled?.did === remote && controlled.now.music ? controlled : null;
  const shown = away
    ? { thumbnail: youtubeThumbnailUrl(away.now.video), title: away.now.title, by: away.now.by }
    : currentTrack && { thumbnail: currentTrack.thumbnail, title: currentTrack.title, by: artistsText(currentTrack.artists) };
  const model: DockModel | null = shown && {
    shown,
    track: currentTrack,
    away,
    playing: away ? away.now.state === "playing" : isPlaying,
    busy: !away && (isBuffering || loadingStreamId !== null),
    muted: isMuted || volume === 0,
    eqActive: eqEnabled,
    popover,
    setPopover,
    accentActive,
    volumeRef: volumeWheelRef,
    menu,
    menuActions,
    buttons: look.buttons,
    look,
  };

  return {
    model,
    /** Whether the bar is on screen: a song here, or the music of a device this one controls. */
    visible: !!model && (!!away || !remote),
    docked: viewState === "dock",
    away,
    pill,
    look,
    surface,
    cover,
    /** The bar's paint: its background's colours, with the controls in the cover's or the plain colours. */
    barStyle: { ...controlColors, ...surface.style } as CSSProperties,
    error,
    popover,
    setPopover,
    volumeFeedback,
    hovered,
    setHovered,
    widthClass: pill ? `h-16 ${PILL_WIDTH[look.width]}` : "h-[72px] w-[90%] max-w-5xl",
    restRadius: pill ? 32 : 16,
  };
}

export type MiniPlayer = ReturnType<typeof useMiniPlayer>;

/** The bar's content: it fills the card's top edge, so it widens with the card as the player grows. */
export function MiniBar({ mini }: { mini: MiniPlayer }) {
  const openOverlay = useMusicPlayerStore((s) => s.openOverlay);
  const sheetDrag = useSheetDrag();
  const { model, away, pill, surface, cover } = mini;
  if (!model) return null;
  return (
    <div
      {...sheetDrag}
      data-music-dock-bar
      onPointerEnter={() => mini.setHovered(true)}
      onPointerLeave={() => mini.setHovered(false)}
      onClick={(e) => {
        if (away) return;
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest("button, [role='slider'], [data-sheet-drag-ignore], a, input, select, textarea")) return;
        openOverlay("full");
      }}
      className={`group relative isolate flex h-full touch-none select-none items-center ${
        pill ? "gap-3 ps-1.5 pe-3" : "ps-3 pe-4"
      } ${away ? "" : "cursor-pointer"}`}
    >
      {surface.coverColors && (
        <>
          <div className="pointer-events-none absolute inset-0 -z-10">
            <LyricsCoverBackground cover={cover} moving={false} />
          </div>
          <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-chrome-black/40" />
        </>
      )}
      {/* Grab handle, shown on hover so the drag up is discoverable. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1 h-1 w-8 -translate-x-1/2 rounded-full bg-chrome-neutral-600 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
      />
      {pill ? <PillDockBody model={model} /> : <ClassicDockBody model={model} />}
    </div>
  );
}

/** What floats around the resting bar outside the card's clip: Dismiss, a playback failure and the popovers. */
export function MiniChrome({ mini }: { mini: MiniPlayer }) {
  const dismiss = useMusicPlayerStore((s) => s.dismiss);
  const { away, pill, look, error, popover, setPopover, volumeFeedback, hovered } = mini;
  return (
    <>
      {/* Dismiss: appears on hover at the corner, unless the Pill already shows Close. */}
      {!away && !(pill && look.buttons.includes("close")) && (
        <HapticButton
          onClick={dismiss}
          onPointerEnter={() => mini.setHovered(true)}
          onPointerLeave={() => mini.setHovered(false)}
          aria-label={getString("music_dismiss")}
          className={`pointer-events-auto absolute -end-2.5 -top-2.5 z-20 grid h-6 w-6 place-items-center rounded-full border border-chrome-neutral-700 bg-surface-container-highest text-chrome-neutral-300 transition-opacity duration-200 ease-out hover:text-chrome-neutral-100 ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <X className="h-3.5 w-3.5" />
        </HapticButton>
      )}

      {/* Playback failure, above the bar so the transport stays usable. */}
      {error.errorInfo && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-full mb-3">
          <PlayerErrorState
            variant="compact"
            error={error.errorInfo}
            onRetry={error.onRetry}
            onCopyLogs={error.onCopyLogs}
            onOpenInBrowser={error.onOpenInBrowser}
          />
        </div>
      )}

      <div className="pointer-events-auto absolute bottom-full end-2 mb-3">
        <EqPanel open={popover === "eq"} onClose={() => setPopover(() => null)} placement="top" />
      </div>
      <div className="pointer-events-auto absolute bottom-full end-2 mb-3">
        {volumeFeedback && popover !== "vol" && <VolumeFeedbackPill feedback={volumeFeedback} tone="surface" />}
        <VolumePopover open={popover === "vol"} onClose={() => setPopover((p) => (p === "vol" ? null : p))} />
      </div>
    </>
  );
}
