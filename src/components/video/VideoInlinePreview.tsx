import { useEffect, useRef, useState, type MouseEvent } from "react";
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
import type { CaptionTrack } from "../../types/video";
import { SubtitleOverlay } from "../player/SubtitleOverlay";

interface VideoInlinePreviewProps {
  videoId: string;
  /** The card has a button of its own in the top end corner, so the preview's start below it. */
  clearTopEnd?: boolean;
}

const RESOLVE_TIMEOUT_MS = 12_000;

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
        className={`absolute inset-0 h-full w-full bg-chrome-black object-contain transition-opacity duration-150 ease-out ${playing ? "opacity-100" : "opacity-0"}`}
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
    </div>
  );
}
