import { useState } from "react";
import { AnimatePresence, motion, useTransform } from "framer-motion";
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
import { upgradeMusicImageUrl } from "../../../lib/thumbnails";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import { dockOpacity, registerSheetDock, sheetProgress } from "../../../lib/musicSheet";
import { useSheetDrag } from "../../../lib/useSheetDrag";
import { useControlledDevice, useRemoteActive } from "../../../lib/live/usePlayOn";
import { youtubeThumbnailUrl } from "../../../lib/thumbnails";
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

export function MiniLayer() {
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

  const openOverlay = useMusicPlayerStore((s) => s.openOverlay);
  const dismiss = useMusicPlayerStore((s) => s.dismiss);
  const look = useMiniPlayerLook();
  const pill = look.style === "pill";

  const { errorInfo, onRetry, onCopyLogs, onOpenInBrowser } = useMusicPlayerError();

  const [popover, setPopover] = useState<null | "eq" | "vol">(null);
  const menu = useMusicContextMenu(Boolean(currentTrack));
  const menuActions = useNowPlayingMenuActions(currentTrack);

  // Same artwork URL the overlay samples, so this reads a warm cache entry.
  const accentSrc = useProxiedImageUrl(upgradeMusicImageUrl(currentTrack?.thumbnail));
  const swatches = useArtworkSwatches(accentSrc);
  const accentActive = useDockToggleColors(swatches);
  const controlColors = useDockControlColors(swatches);
  const surface = useMiniBarSurface(look.background, swatches);
  const cover = useLyricsCover(accentSrc, surface.coverColors);

  const loading = isBuffering || loadingStreamId !== null;
  const muted = isMuted || volume === 0;

  // The dock stays under the full player, so the player can grow out of it and sink back into it.
  const docked = viewState === "dock";
  const sheetDrag = useSheetDrag();
  const opacity = useTransform(sheetProgress, dockOpacity);
  // While this device controls another, the dock shows that device's music and its buttons drive
  // it (the player's actions go there); a video there gets the remote dock instead.
  const remote = useRemoteActive();
  const controlled = useControlledDevice();
  const away = remote && controlled?.did === remote && controlled.now.music ? controlled : null;
  const shown = away
    ? { thumbnail: youtubeThumbnailUrl(away.now.video), title: away.now.title, by: away.now.by }
    : currentTrack && { thumbnail: currentTrack.thumbnail, title: currentTrack.title, by: artistsText(currentTrack.artists) };
  const playing = away ? away.now.state === "playing" : isPlaying;
  const busy = !away && loading;
  const model: DockModel | null = shown && {
    shown,
    track: currentTrack,
    away,
    playing,
    busy,
    muted,
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

  return (
    <AnimatePresence>
      {model && (away || !remote) && (
        <motion.div
          key="music-dock"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
          inert={!docked}
          className={`group fixed bottom-6 left-1/2 z-50 -translate-x-1/2 ${pill ? `h-16 ${PILL_WIDTH[look.width]}` : "h-[72px] w-[90%] max-w-5xl"}`}
        >
          <motion.div style={{ opacity }} className="h-full">
            {/* Dismiss — appears on hover at the corner, unless the Pill already shows Close. */}
            {!away && !(pill && look.buttons.includes("close")) && (
              <HapticButton
                onClick={dismiss}
                aria-label={getString("music_dismiss")}
                className="absolute -end-2.5 -top-2.5 z-20 grid h-6 w-6 place-items-center rounded-full border border-chrome-neutral-700 bg-surface-container-highest text-chrome-neutral-300 opacity-0 transition-opacity duration-200 ease-out hover:text-chrome-neutral-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </HapticButton>
            )}

            {/* Playback failure — floats above the pill so transport stays usable. */}
            {errorInfo && (
              <div className="absolute inset-x-0 bottom-full mb-3">
                <PlayerErrorState
                  variant="compact"
                  error={errorInfo}
                  onRetry={onRetry}
                  onCopyLogs={onCopyLogs}
                  onOpenInBrowser={onOpenInBrowser}
                />
              </div>
            )}

            {/* The bar (clips the edge progress line and the cover colours to its corners). Drag it up to open the player. */}
            <div
              ref={registerSheetDock}
              {...sheetDrag}
              data-music-dock-bar
              onClick={(e) => {
                if (away) return;
                const target = e.target instanceof Element ? e.target : null;
                if (target?.closest("button, [role='slider'], [data-sheet-drag-ignore], a, input, select, textarea")) {
                  return;
                }
                openOverlay("full");
              }}
              // Vivid paints its own controls, so the bar's surface wins over the control colours.
              style={{ ...controlColors, ...surface.style }}
              className={`relative isolate flex h-full touch-none select-none items-center overflow-hidden bg-surface-container-high ${
                pill ? "gap-3 rounded-full ps-1.5 pe-3 shadow-[0_8px_24px_rgb(0_0_0/0.35)]" : "rounded-2xl ps-3 pe-4"
              } ${surface.bordered ? "border border-chrome-neutral-800" : ""} ${away ? "" : "cursor-pointer"}`}
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

            {/* Popovers — rendered outside the clipped pill so they aren't cut off. */}
            <div className="absolute bottom-full end-2 mb-3">
              <EqPanel
                open={popover === "eq"}
                onClose={() => setPopover(null)}
                placement="top"
              />
            </div>
            <div className="absolute bottom-full end-2 mb-3">
              {volumeFeedback && popover !== "vol" && (
                <VolumeFeedbackPill feedback={volumeFeedback} tone="surface" />
              )}
              <VolumePopover
                open={popover === "vol"}
                onClose={() => setPopover((p) => (p === "vol" ? null : p))}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
