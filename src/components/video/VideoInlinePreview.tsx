import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import * as dashjs from "dashjs";
import { Captions, Volume2, VolumeX } from "lucide-react";
import { createProxiedDashPlayer } from "../../lib/dashSetup";
import { manifestVideoTracks, pickDashStart, readMeasuredSpeedKbps, recordVideoSegmentSpeed } from "../../lib/dashStartQuality";
import { getString } from "../../lib/i18n/index";
import {
  INLINE_PLAY_DELAY_MS,
  INLINE_RESOLVE_DELAY_MS,
  inlinePreviewCaptionId,
  inlinePreviewSource,
  type InlinePreviewSource,
} from "../../lib/inlinePreview";
import { pauseOtherPlayback } from "../../lib/pauseOtherPlayback";
import { SETTINGS } from "../../lib/settings/schema";
import { resolveStreamInfo } from "../../lib/streamResolution";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { formatTime } from "../../lib/musicFormat";
import { paintStoryboardTile, pickStoryboardLevel, storyboardTileHeight } from "../../lib/seekPreview";
import { proxiedImage } from "../../lib/imageProxy";
import { useImageProxyStore } from "../../store/useImageProxyStore";
import type { CaptionTrack, StoryboardLevel } from "../../types/video";
import { SubtitleOverlay } from "../player/SubtitleOverlay";
import { MediaScrubber } from "../ui/MediaScrubber";

interface VideoInlinePreviewProps {
  videoId: string;
  /** The card has a button of its own in the top end corner, so the preview's start below it. */
  clearTopEnd?: boolean;
}

const RESOLVE_TIMEOUT_MS = 12_000;
// About a third of a grid card, as YouTube draws it.
const SEEK_TILE_WIDTH = 112;

function supportsCodec(codec: string): boolean {
  return typeof MediaSource === "undefined" || typeof MediaSource.isTypeSupported !== "function" || MediaSource.isTypeSupported(codec);
}

/** Keeps a click on a preview button from opening the card underneath. */
function own(handler: () => void) {
  return (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
}

const BUTTON =
  "grid h-8 w-8 place-items-center rounded-full bg-chrome-black/60 text-chrome-white transition-colors duration-200 ease-out hover:bg-chrome-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * The hovered card's own video: muted, captions on, at the quality the connection carries
 * and no taller than the card. It records nothing and never touches the player's state.
 */
export function VideoInlinePreview({ videoId, clearTopEnd = false }: VideoInlinePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<InlinePreviewSource | null>(null);
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const [due, setDue] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [storyboard, setStoryboard] = useState<StoryboardLevel[]>([]);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const proxyBase = useImageProxyStore((state) => state.base);
  const preferredLanguage = useAppSettingsStore((state) => state.values[SETTINGS.PREFERRED_SUBTITLE_LANGUAGE] ?? "en");
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    const resolveTimer = window.setTimeout(() => {
      resolveStreamInfo(videoId, { timeoutMs: RESOLVE_TIMEOUT_MS })
        .then((info) => {
          if (cancelled) return;
          const picked = inlinePreviewSource(info);
          if (!picked) setFailed(true);
          setSource(picked);
          setCaptions(info.captions ?? []);
          setStoryboard(info.storyboard ?? []);
        })
        .catch(() => !cancelled && setFailed(true));
    }, INLINE_RESOLVE_DELAY_MS);
    const playTimer = window.setTimeout(() => setDue(true), INLINE_PLAY_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(resolveTimer);
      window.clearTimeout(playTimer);
    };
  }, [videoId, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !due) return;
    video.muted = true;
    const fail = () => setFailed(true);
    video.addEventListener("error", fail);

    if (source.kind === "direct") {
      video.src = source.url;
      void video.play().catch(fail);
      return () => {
        video.removeEventListener("error", fail);
        video.removeAttribute("src");
        video.load();
      };
    }

    const player = createProxiedDashPlayer(source.url, {
      // Auto, as the player, but never taller than the card: pixels it can't show only slow the start.
      abr: { limitBitrateByPortal: true, usePixelRatioInLimitBitrateByPortal: true },
      buffer: { bufferTimeDefault: 4, bufferToKeep: 10 },
    });
    const events = dashjs.MediaPlayer.events;
    // The player's own start rule: begin at what the measured speed carries, then let ABR climb.
    const onManifestLoaded = (event: unknown) => {
      const start = pickDashStart({
        selected: null,
        tracks: manifestVideoTracks((event as { data?: unknown } | null)?.data).filter((track) => !track.codec || supportsCodec(track.codec)),
        preferredCodec: useAppSettingsStore.getState().values[SETTINGS.DEFAULT_VIDEO_CODEC] ?? "H.264",
        speedKbps: readMeasuredSpeedKbps(),
      });
      if (start.bitrateKbps) player.updateSettings({ streaming: { abr: { initialBitrate: { video: start.bitrateKbps } } } });
      if (start.setId) player.setInitialMediaSettingsFor("video", { id: start.setId });
    };
    player.on(events.MANIFEST_LOADED, onManifestLoaded);
    player.on(events.FRAGMENT_LOADING_COMPLETED, recordVideoSegmentSpeed);
    player.on(events.ERROR, fail);
    player.initialize(video, source.url, true);
    return () => {
      player.off(events.MANIFEST_LOADED, onManifestLoaded);
      player.off(events.FRAGMENT_LOADING_COMPLETED, recordVideoSegmentSpeed);
      player.off(events.ERROR, fail);
      video.removeEventListener("error", fail);
      player.reset();
    };
  }, [source, due]);

  const seekLevel = pickStoryboardLevel(storyboard, SEEK_TILE_WIDTH);
  const readClock = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  useEffect(() => {
    const tile = tileRef.current;
    if (!tile || !seekLevel || hoverRatio === null || !(duration > 0)) return;
    paintStoryboardTile(tile, seekLevel, hoverRatio * duration, (url) => proxiedImage(url, proxyBase), SEEK_TILE_WIDTH);
  }, [seekLevel, hoverRatio, duration, proxyBase]);

  if (reducedMotion || failed) return null;

  const captionId = captionsOn ? inlinePreviewCaptionId(captions, preferredLanguage) : null;

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (muted) {
      // Sound from a card is a choice to listen: whatever else plays steps aside.
      pauseOtherPlayback();
      video.volume = usePlayerStore.getState().volume;
    }
    video.muted = !muted;
    setMuted(!muted);
  };

  return (
    <div className="absolute inset-0 z-20" data-inline-preview>
      <video
        ref={videoRef}
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onProgress={(event) => {
          const ranges = event.currentTarget.buffered;
          setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0);
        }}
        className={`absolute inset-0 h-full w-full bg-chrome-black object-contain transition-opacity duration-150 ease-out ${playing ? "opacity-100" : "opacity-0"}`}
      />
      {/* Seeking dims the picture so the frame being sought stands out. */}
      <div
        className={`pointer-events-none absolute inset-0 bg-chrome-black/30 transition-opacity duration-150 ease-out ${hoverRatio === null ? "opacity-0" : "opacity-100"}`}
      />
      {playing && captionId && (
        <SubtitleOverlay captions={captions} selectedCaptionId={captionId} currentTime={time} shouldShowControls={false} still />
      )}
      {playing && (
        <div className={`absolute end-2 z-30 flex flex-col gap-1.5 ${clearTopEnd ? "top-12" : "top-2"}`}>
          <button
            type="button"
            className={BUTTON}
            onClick={own(toggleMute)}
            aria-label={getString(muted ? "music_unmute" : "music_mute")}
            title={getString(muted ? "music_unmute" : "music_mute")}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {captions.length > 0 && (
            <button
              type="button"
              className={`${BUTTON} ${captionsOn ? "text-chrome-white" : "text-chrome-white/60"}`}
              onClick={own(() => setCaptionsOn((on) => !on))}
              aria-pressed={captionsOn}
              aria-label={getString("player_menu_captions")}
              title={getString("player_menu_captions")}
            >
              <Captions size={16} />
            </button>
          )}
        </div>
      )}
      {playing && duration > 0 && (
        <>
          <span className="pointer-events-none absolute bottom-2.5 end-1.5 rounded bg-chrome-black/80 px-1 py-px text-[12px] font-medium leading-tight tracking-wide text-chrome-white">
            {formatTime(Math.max(0, duration - time))}
          </span>
          {hoverRatio !== null && (
            <div
              className="pointer-events-none absolute bottom-4 flex flex-col items-center gap-1"
              // A timeline runs left to right in every language, as the bar under it does.
              style={{
                left: `clamp(${SEEK_TILE_WIDTH / 2 + 4}px, ${hoverRatio * 100}%, calc(100% - ${SEEK_TILE_WIDTH / 2 + 4}px))`,
                transform: "translateX(-50%)",
              }}
            >
              {seekLevel && (
                <div
                  ref={tileRef}
                  className="overflow-hidden rounded-lg border-2 border-chrome-white bg-chrome-black bg-no-repeat"
                  style={{ width: SEEK_TILE_WIDTH, height: storyboardTileHeight(seekLevel, SEEK_TILE_WIDTH) }}
                />
              )}
              <span className="text-[13px] font-semibold text-chrome-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
                {formatTime(hoverRatio * duration)}
              </span>
            </div>
          )}
          {/* Clicks on the bar seek; they mustn't open the card. */}
          <div className="absolute inset-x-0 bottom-0 z-30" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
            <MediaScrubber
              variant="edge"
              progress={time}
              duration={duration}
              buffered={buffered}
              onSeek={(seconds) => {
                const video = videoRef.current;
                if (video) video.currentTime = seconds;
                setTime(seconds);
              }}
              onHover={setHoverRatio}
              clock={readClock}
              playing
            />
          </div>
        </>
      )}
    </div>
  );
}
