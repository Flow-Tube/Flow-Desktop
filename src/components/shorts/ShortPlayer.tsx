import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { getReturnYouTubeDislike, type RydData } from "../../lib/api/foss";
import { useShortDetails } from "../../lib/useShortDetails";
import { useVideoComments } from "../../lib/useVideoComments";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useShortStream } from "../../lib/useShortStream";
import { IS_LINUX_RUNTIME } from "../../lib/platform";
import { useSettingsStore } from "../../store/useSettingsStore";
import { ShortVideoSurface } from "./ShortVideoSurface";
import { ShortMetadata } from "./ShortMetadata";
import { ShortActionBar } from "./ShortActionBar";
import { ShortSidePanel } from "./ShortSidePanel";
import type { ShortItem, ShortsPanelState } from "../../types/shorts";

const SIDE_PANEL_WIDTH = 560;

interface ShortPlayerProps {
  short: ShortItem;
  active: boolean;
  preload: boolean;
  muted: boolean;
  playbackMode: string;
  autoScrollSeconds: number;
  panelState: ShortsPanelState;
  onRequestPanel: (panel: ShortsPanelState) => void;
  onToggleMute: () => void;
  onRequestAdvance: () => void;
  onUnavailable: () => void;
}

export function ShortPlayer({
  short,
  active,
  preload,
  muted,
  playbackMode,
  autoScrollSeconds,
  panelState,
  onRequestPanel,
  onToggleMute,
  onRequestAdvance,
  onUnavailable,
}: ShortPlayerProps) {
  const [activeRetryToken, setActiveRetryToken] = useState(0);
  const [activeRetryAttempted, setActiveRetryAttempted] = useState(false);
  const thumbnail = useProxiedImageUrl(short.thumbnailUrl);
  const panelOpen = active && panelState !== "none";
  const { details } = useShortDetails(short.id, active);
  const { countText: fetchedCommentCountText } = useVideoComments(active ? short.id : undefined);
  const rytdEnabled = useSettingsStore((s) => s.rytdEnabled);
  const [rydData, setRydData] = useState<RydData | null>(null);
  const commentCountText = short.commentCountText ?? fetchedCommentCountText;

  useEffect(() => {
    if (!active || !rytdEnabled) {
      setRydData(null);
      return;
    }

    let cancelled = false;
    getReturnYouTubeDislike(short.id).then((data) => {
      if (!cancelled) setRydData(data);
    });
    return () => {
      cancelled = true;
    };
  }, [active, rytdEnabled, short.id]);

  useEffect(() => {
    setActiveRetryAttempted(false);
    setActiveRetryToken(0);
  }, [short.id]);

  const {
    dashUrl,
    videoUrl,
    audioUrl,
    variants,
    captions,
    selectedQualityId,
    loading,
    unavailable,
    selectQuality,
  } = useShortStream(
    short.id,
    active || preload,
    activeRetryToken,
  );

  // A Short whose stream can't be resolved is skipped so the feed never stalls.
  useEffect(() => {
    if (!active || !unavailable || loading) return;
    if (!activeRetryAttempted) {
      setActiveRetryAttempted(true);
      setActiveRetryToken((value) => value + 1);
      return;
    }
    onUnavailable();
  }, [active, activeRetryAttempted, loading, unavailable, onUnavailable]);

  return (
    <div className="relative h-[calc(100vh-64px)] w-full overflow-hidden flex items-end justify-center pb-10">
      {thumbnail && active && !IS_LINUX_RUNTIME && (
        <img
          src={thumbnail}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover blur-[120px] scale-125 opacity-50 saturate-[1.5] pointer-events-none"
        />
      )}
      <div className="absolute inset-0 bg-chrome-neutral-950/60 pointer-events-none" />

      <motion.div
        layout={active}
        className="relative z-10 flex w-full max-w-none flex-row items-end justify-center gap-6 px-6 lg:gap-8"
      >
        {active ? (
          <ShortMetadata
            short={short}
            details={details}
            onOpenDescription={() => onRequestPanel("description")}
          />
        ) : (
          <div className="mb-4 w-[260px] lg:w-[280px]" />
        )}

        <motion.div
          layout={active}
          className="flex h-[85vh] max-h-[850px] flex-row overflow-hidden rounded-2xl bg-chrome-black ring-1 ring-chrome-white/10"
        >
          <div className="relative z-20 aspect-[9/16] h-full bg-chrome-black">
            <ShortVideoSurface
              dashUrl={active ? dashUrl : null}
              videoUrl={active ? videoUrl : null}
              audioUrl={active ? audioUrl : null}
              qualities={variants}
              captions={captions}
              selectedQualityId={selectedQualityId}
              onSelectQuality={selectQuality}
              poster={thumbnail}
              active={active}
              muted={muted}
              playbackMode={playbackMode}
              autoScrollSeconds={autoScrollSeconds}
              onRequestAdvance={onRequestAdvance}
              onError={() => {
                console.error(`[shorts] video error ${short.id}`, dashUrl, videoUrl);
                onUnavailable();
              }}
            />

            {active && loading && !dashUrl && !videoUrl && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <Loader2 className="h-8 w-8 animate-spin text-chrome-white/80" />
              </div>
            )}

            {active && unavailable && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-chrome-black/40">
                <p className="text-sm text-chrome-white/70">Skipping unavailable Short...</p>
              </div>
            )}

            {active && (
              <button
                type="button"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={onToggleMute}
                className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-chrome-black/55 text-chrome-white transition-colors duration-200 ease-out hover:bg-chrome-black/75"
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
          </div>

          <motion.div
            layout={active}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? SIDE_PANEL_WIDTH : 0, opacity: 1 }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className={`flex h-full flex-col overflow-hidden bg-surface-container-high ${
              panelOpen ? "border-l border-chrome-neutral-800" : ""
            }`}
          >
            {panelOpen && (
              <ShortSidePanel
                short={short}
                details={details}
                rydData={rydData}
                commentCountText={commentCountText}
                panelState={panelState}
                onClose={() => onRequestPanel("none")}
              />
            )}
          </motion.div>
        </motion.div>

        {active ? (
          <ShortActionBar
            short={short}
            details={details}
            rydData={rydData}
            commentCountText={commentCountText}
            onRequestPanel={onRequestPanel}
            onRequestAdvance={onRequestAdvance}
          />
        ) : (
          <div className="mb-4 w-[260px] lg:w-[280px]" />
        )}
      </motion.div>
    </div>
  );
}
