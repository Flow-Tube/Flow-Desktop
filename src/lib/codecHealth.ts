import { profileStorage } from "./storage/profileStorage";
import type { StreamVariant } from "../types/video";

export type VideoCodecFamily = "h264" | "vp9" | "av1";

export interface DecodeFailure {
  videoId: string;
  at: number;
  /** False when the video had already hopped into this codec from another one. */
  directStart: boolean;
}

export type DecodeFailures = Partial<Record<VideoCodecFamily, DecodeFailure[]>>;

const STORAGE_KEY = "video_decode_failures";
// A browser can report a codec as supported and still fail to decode a video, so one
// failure only rules the codec out for that video. Several videos that started directly
// in the codec mean it isn't working here. A failure right after hopping from another
// codec doesn't count: the same bytes have played fine when the video started on them.
const FAILING_VIDEOS_FOR_DEVICE = 3;
// Long enough to stop repeat failures, short enough that an OS or engine update gets a new try.
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REMEMBERED_VIDEOS = 50;

const SUPPORT_PROBES: Record<VideoCodecFamily, string[]> = {
  h264: ['video/mp4; codecs="avc1.640028"'],
  vp9: ['video/webm; codecs="vp09.00.40.08"', 'video/mp4; codecs="vp09.00.40.08"', 'video/webm; codecs="vp9"'],
  av1: ['video/mp4; codecs="av01.0.08M.08"'],
};

export function codecFamily(codec: string | null | undefined): VideoCodecFamily | null {
  const value = codec?.toLowerCase() ?? "";
  if (value.includes("avc1") || value.includes("avc3") || value.includes("h264")) return "h264";
  if (value.includes("vp09") || value.includes("vp9")) return "vp9";
  if (value.includes("av01") || value.includes("av1")) return "av1";
  return null;
}

/** What the browser claims. A yes doesn't promise every video decodes, a no is final. */
export function deviceSupportsCodec(family: VideoCodecFamily): boolean {
  if (typeof MediaSource === "undefined" || typeof MediaSource.isTypeSupported !== "function") return true;
  return SUPPORT_PROBES[family].some((type) => MediaSource.isTypeSupported(type));
}

const recent = (failures: DecodeFailures, family: VideoCodecFamily, now: number) =>
  (failures[family] ?? []).filter((failure) => now - failure.at < REMEMBER_MS);

export function isCodecFailingOnDevice(failures: DecodeFailures, family: VideoCodecFamily, now = Date.now()): boolean {
  return recent(failures, family, now).filter((failure) => failure.directStart).length >= FAILING_VIDEOS_FOR_DEVICE;
}

export function isCodecRuledOut(
  failures: DecodeFailures,
  codec: string | null | undefined,
  videoId: string | null | undefined,
  now = Date.now(),
): boolean {
  const family = codecFamily(codec);
  if (!family) return false;
  return isCodecFailingOnDevice(failures, family, now)
    || recent(failures, family, now).some((failure) => failure.videoId === videoId);
}

export function withDecodeFailure(
  failures: DecodeFailures,
  family: VideoCodecFamily,
  videoId: string,
  directStart: boolean,
  now = Date.now(),
): DecodeFailures {
  const others = recent(failures, family, now).filter((failure) => failure.videoId !== videoId);
  return { ...failures, [family]: [...others, { videoId, at: now, directStart }].slice(-MAX_REMEMBERED_VIDEOS) };
}

/** Falls back to every track rather than none, so a ruled-out codec still beats no video. */
export function withoutRuledOutCodecs<T extends { codec?: string | null }>(
  tracks: T[],
  failures: DecodeFailures,
  videoId: string | null | undefined,
): T[] {
  const usable = tracks.filter((track) => !isCodecRuledOut(failures, track.codec, videoId));
  return usable.length > 0 ? usable : tracks;
}

/**
 * The codec to leave behind after a decode error, or null when the usual source
 * fallback should handle it: H.264 is the last resort, so there's nowhere better to
 * go, and a video offered only in the failing codec has nothing else to play.
 */
export function codecToLeaveAfterDecodeError(
  currentCodec: string | null | undefined,
  qualities: StreamVariant[],
): VideoCodecFamily | null {
  const family = codecFamily(currentCodec);
  if (!family || family === "h264") return null;
  const hasAlternative = qualities.some((quality) => {
    const other = codecFamily(quality.mimeType);
    return quality.isVideoOnly && !!other && other !== family;
  });
  return hasAlternative ? family : null;
}

export function loadDecodeFailures(): DecodeFailures {
  try {
    const parsed = JSON.parse(profileStorage.getItem(STORAGE_KEY, "device") ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDecodeFailures(failures: DecodeFailures): void {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(failures), "device");
  } catch {
    // Without storage, the failure is only remembered until Flow closes.
  }
}
