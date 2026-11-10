import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateStreamInfo, prefetchStreamInfo, resolveStreamInfo } from "./streamResolution";
import { codecRank } from "./codecPreference";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { AudioTrack, CaptionTrack, StreamInfo, StreamVariant } from "../types/video";

export const RESOLVE_TIMEOUT_MS = 12_000;
const TARGET_SHORT_HEIGHT = 720;

interface ShortPlaybackSource {
  dashUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
}

function isMp4(mime?: string | null): boolean {
  return !!mime && mime.toLowerCase().includes("mp4");
}

function qualityHeight(value: string | null | undefined): number | null {
  if (!value || value === "Auto" || value === "auto") return null;
  const parsed = Number(value.replace(/p$/i, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function variantHeight(variant: StreamVariant): number {
  const labelHeight = qualityHeight(variant.qualityLabel);
  if (labelHeight) return labelHeight;
  const width = variant.width ?? 0;
  const height = variant.height ?? 0;
  if (width > 0 && height > 0) return Math.min(width, height);
  return height || width || 0;
}

function canPlayMime(mime?: string | null): boolean {
  if (!mime || typeof document === "undefined") return true;
  const video = document.createElement(mime.startsWith("audio/") ? "audio" : "video");
  return video.canPlayType(mime) !== "";
}

export function pickDirectUrl(info: StreamInfo): string | null {
  const muxed = (info.variants || [])
    .filter(
      (variant) =>
        variant.isPlayable &&
        variant.hasAudio &&
        !!variant.localUrl &&
        canPlayMime(variant.mimeType),
    )
    .sort(
      (a, b) =>
        codecRank(a.mimeType) - codecRank(b.mimeType) ||
        Number(isMp4(b.mimeType)) - Number(isMp4(a.mimeType)) ||
        (b.height ?? 0) - (a.height ?? 0),
    );
  return muxed[0]?.localUrl ?? null;
}

function playableAdaptiveVariants(info: StreamInfo): StreamVariant[] {
  return (info.variants || []).filter(
    (variant) =>
      variant.isPlayable &&
      variant.isVideoOnly &&
      !!variant.localUrl &&
      canPlayMime(variant.mimeType),
  );
}

function playableMuxedVariants(info: StreamInfo): StreamVariant[] {
  return (info.variants || []).filter(
    (variant) =>
      variant.isPlayable &&
      variant.hasAudio &&
      !!variant.localUrl &&
      canPlayMime(variant.mimeType),
  );
}

function sortByShortPreference(variants: StreamVariant[], targetHeight: number | null): StreamVariant[] {
  return [...variants].sort((a, b) => {
    const aHeight = variantHeight(a);
    const bHeight = variantHeight(b);
    const target = targetHeight ?? TARGET_SHORT_HEIGHT;
    const aOver = aHeight > target ? 1 : 0;
    const bOver = bHeight > target ? 1 : 0;
    return (
      aOver - bOver ||
      codecRank(a.mimeType) - codecRank(b.mimeType) ||
      Number(isMp4(b.mimeType)) - Number(isMp4(a.mimeType)) ||
      Math.abs(aHeight - target) - Math.abs(bHeight - target) ||
      (b.bitrate ?? 0) - (a.bitrate ?? 0)
    );
  });
}

function selectPlayableVariant(variants: StreamVariant[], qualityIdOrLabel?: string): StreamVariant | null {
  if (!variants.length) return null;
  if (qualityIdOrLabel && qualityIdOrLabel !== "Auto" && qualityIdOrLabel !== "auto") {
    const byId = variants.find((variant) => variant.id === qualityIdOrLabel);
    if (byId) return byId;

    const targetHeight = qualityHeight(qualityIdOrLabel);
    if (targetHeight) {
      return sortByShortPreference(variants, targetHeight)[0] ?? null;
    }
  }
  return sortByShortPreference(variants, null)[0] ?? null;
}

export function pickAdaptiveVideoVariant(info: StreamInfo, qualityIdOrLabel = "720p"): StreamVariant | null {
  return selectPlayableVariant(playableAdaptiveVariants(info), qualityIdOrLabel);
}

export function pickAdaptiveVideoUrl(info: StreamInfo, qualityIdOrLabel = "720p"): string | null {
  return pickAdaptiveVideoVariant(info, qualityIdOrLabel)?.localUrl ?? null;
}

export function pickDirectVariant(info: StreamInfo, qualityIdOrLabel = "auto"): StreamVariant | null {
  const muxed = playableMuxedVariants(info);
  if (qualityIdOrLabel === "auto" || qualityIdOrLabel === "Auto") {
    return [...muxed].sort(
      (a, b) =>
        codecRank(a.mimeType) - codecRank(b.mimeType) ||
        Number(isMp4(b.mimeType)) - Number(isMp4(a.mimeType)) ||
        (variantHeight(b) ?? 0) - (variantHeight(a) ?? 0),
    )[0] ?? null;
  }
  return selectPlayableVariant(muxed, qualityIdOrLabel);
}

export function pickAdaptiveVideoUrlLegacy(info: StreamInfo): string | null {
  const variants = (info.variants || [])
    .filter(
      (variant) =>
        variant.isPlayable &&
        variant.isVideoOnly &&
        !!variant.localUrl &&
        canPlayMime(variant.mimeType),
    )
    .sort((a, b) => {
      const aHeight = a.height ?? 0;
      const bHeight = b.height ?? 0;
      const aOver = aHeight > TARGET_SHORT_HEIGHT ? 1 : 0;
      const bOver = bHeight > TARGET_SHORT_HEIGHT ? 1 : 0;
      return (
        aOver - bOver ||
        codecRank(a.mimeType) - codecRank(b.mimeType) ||
        Number(isMp4(b.mimeType)) - Number(isMp4(a.mimeType)) ||
        Math.abs(aHeight - TARGET_SHORT_HEIGHT) - Math.abs(bHeight - TARGET_SHORT_HEIGHT) ||
        (b.bitrate ?? 0) - (a.bitrate ?? 0)
      );
    });
  return variants[0]?.localUrl ?? null;
}

const playableAudioTracks = (info: StreamInfo): AudioTrack[] =>
  (info.audioTracks || []).filter((track) => track.available && !!track.localUrl && canPlayMime(track.mimeType));

/** One entry per language: a track comes in several bitrates, and the menu offers the language. */
export function shortAudioChoices(info: StreamInfo): AudioTrack[] {
  const byLabel = new Map<string, AudioTrack>();
  for (const track of sortedAudioTracks(playableAudioTracks(info))) {
    if (!byLabel.has(track.label)) byLabel.set(track.label, track);
  }
  return [...byLabel.values()];
}

function sortedAudioTracks(tracks: AudioTrack[]): AudioTrack[] {
  return [...tracks]
    .sort((a, b) => {
      const defaultRank = Number(b.isDefault) - Number(a.isDefault);
      if (defaultRank !== 0) return defaultRank;
      const mp4Rank = Number(isMp4(b.mimeType)) - Number(isMp4(a.mimeType));
      if (mp4Rank !== 0) return mp4Rank;
      return (b.bitrate ?? 0) - (a.bitrate ?? 0);
    });
}

export function pickAudioUrl(info: StreamInfo, audioTrackId?: string | null): string | null {
  const tracks = sortedAudioTracks(playableAudioTracks(info));
  const chosen = audioTrackId ? tracks.find((track) => track.id === audioTrackId) : undefined;
  return (chosen ?? tracks[0])?.localUrl ?? null;
}

export function selectShortPlaybackSource(
  info: StreamInfo,
  qualityIdOrLabel = "720p",
  audioTrackId?: string | null,
): ShortPlaybackSource {
  const adaptiveVideo = pickAdaptiveVideoVariant(info, qualityIdOrLabel);
  const audioUrl = pickAudioUrl(info, audioTrackId);
  if (adaptiveVideo) {
    return {
      dashUrl: info.dashManifestUrl ?? null,
      videoUrl: adaptiveVideo.localUrl,
      audioUrl,
    };
  }

  return {
    dashUrl: info.dashManifestUrl ?? null,
    videoUrl: pickDirectVariant(info, qualityIdOrLabel)?.localUrl ?? pickDirectUrl(info),
    audioUrl: null,
  };
}

function fetchShortStreamInfo(videoId: string): Promise<StreamInfo> {
  return resolveStreamInfo(videoId, { timeoutMs: RESOLVE_TIMEOUT_MS });
}

/**
 * Warms the streams for the Shorts a swipe is about to reach.
 *
 * The pager only mounts a player once a Short is close enough to the active
 * index, so without this every swipe pays a full resolve before the first frame.
 * Warming is bounded and single-flighted in [prefetchStreamInfo], so the active
 * Short's own resolve is never queued behind a neighbour's.
 */
export function prefetchShortStreams(videoIds: readonly (string | null | undefined)[]) {
  for (const videoId of videoIds) prefetchStreamInfo(videoId);
}

function visibleShortQualities(variants: StreamVariant[]): StreamVariant[] {
  const playable = variants.filter(
    (variant) =>
      variant.isPlayable &&
      !!variant.localUrl &&
      canPlayMime(variant.mimeType) &&
      (variant.isVideoOnly || variant.hasAudio),
  );
  return [...playable].sort((a, b) => variantHeight(b) - variantHeight(a));
}

export function useShortStream(videoId: string, shouldLoad: boolean, retryToken = 0) {
  const preferredShortsQuality = useAppSettingsStore((s) => s.values[SETTINGS.SHORTS_QUALITY_WIFI] ?? "720p");
  const [dashUrl, setDashUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [variants, setVariants] = useState<StreamVariant[]>([]);
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string>(
    preferredShortsQuality === "Auto" ? "auto" : preferredShortsQuality,
  );
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const retryTokenRef = useRef(retryToken);
  const streamInfoRef = useRef<StreamInfo | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const qualityRef = useRef<string>("720p");
  const selectedAudioRef = useRef<string | null>(null);

  const applyStreamInfo = useCallback((info: StreamInfo, qualityIdOrLabel: string, audioTrackId?: string | null) => {
    streamInfoRef.current = info;
    qualityRef.current = qualityIdOrLabel;
    setVariants(visibleShortQualities(info.variants || []));
    setCaptions(info.captions || []);
    setAudioTracks(shortAudioChoices(info));
    const source = selectShortPlaybackSource(info, qualityIdOrLabel, audioTrackId);
    setDashUrl(source.dashUrl);
    setVideoUrl(source.videoUrl);
    setAudioUrl(source.audioUrl);
    setUnavailable(!source.dashUrl && !source.videoUrl);
    if (qualityIdOrLabel === "Auto") {
      setSelectedQualityId("auto");
    }
  }, []);

  const selectQuality = useCallback((variant: StreamVariant | "auto") => {
    const info = streamInfoRef.current;
    if (!info) return;
    const nextQuality = variant === "auto" ? "Auto" : variant.id;
    setSelectedQualityId(variant === "auto" ? "auto" : variant.id);
    applyStreamInfo(info, nextQuality, selectedAudioRef.current);
  }, [applyStreamInfo]);

  const selectAudioTrack = useCallback((id: string) => {
    const info = streamInfoRef.current;
    if (!info) return;
    selectedAudioRef.current = id;
    setSelectedAudioTrackId(id);
    applyStreamInfo(info, qualityRef.current, id);
  }, [applyStreamInfo]);

  useEffect(() => {
    if (retryTokenRef.current !== retryToken) {
      retryTokenRef.current = retryToken;
      setUnavailable(false);
      setDashUrl(null);
      setVideoUrl(null);
      setAudioUrl(null);
      setVariants([]);
      setCaptions([]);
      setAudioTracks([]);
      streamInfoRef.current = null;
      invalidateStreamInfo(videoId);
    }
    if (!shouldLoad) return;
    let cancelled = false;
    setLoading(true);

    const preferredQualityId = preferredShortsQuality === "Auto" ? "Auto" : preferredShortsQuality;
    setSelectedQualityId(preferredQualityId === "Auto" ? "auto" : preferredQualityId);

    fetchShortStreamInfo(videoId)
      .then((info) => {
        if (cancelled) return;
        applyStreamInfo(info, preferredQualityId, selectedAudioRef.current);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(`[shorts] stream ${videoId} unavailable:`, err);
        setVariants([]);
        setCaptions([]);
        setUnavailable(true);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [applyStreamInfo, preferredShortsQuality, retryToken, shouldLoad, videoId]);

  return {
    dashUrl,
    videoUrl,
    audioUrl,
    audioTracks,
    selectedAudioTrackId,
    selectAudioTrack,
    variants,
    captions,
    selectedQualityId,
    loading,
    unavailable,
    selectQuality,
  };
}
