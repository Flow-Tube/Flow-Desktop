import { codecRank } from "./codecPreference";
import { codecMatches, videoCodecLabel } from "./settings/playerRuntime";
import type { StreamVariant } from "../types/video";

export interface DashVideoTrack {
  id?: string | null;
  codec?: string | null;
  mimeType?: string | null;
  bitrateList?: Array<{ id?: string | null; width?: number; height?: number; bandwidth?: number }>;
}

interface RepresentationRef {
  id?: string | number | null;
  height?: number;
  codecs?: string | null;
  mimeType?: string | null;
}

/** The player's picture area in device pixels: what Auto has to fill. */
export interface PlayerBox {
  width: number;
  height: number;
}

type Representation = NonNullable<DashVideoTrack["bitrateList"]>[number];

// On Linux most video is decoded on the processor, where each step above 1080p costs more
// than it shows.
const LINUX_AUTO_BOX: PlayerBox = { width: 1920, height: 1080 };
// A picture stretched by a tenth looks the same; one size up costs about twice the decoding.
const FILL_TOLERANCE = 0.9;

/**
 * The area Auto fills, from the player's size in CSS pixels. Null means no limit, which is
 * the case until the player has a size. On Linux the area stops at 1080p.
 */
export function autoQualityBox(
  widthPx: number,
  heightPx: number,
  pixelRatio: number,
  isLinux: boolean,
): PlayerBox | null {
  const width = Math.round(widthPx * pixelRatio);
  const height = Math.round(heightPx * pixelRatio);
  if (!(width > 0) || !(height > 0)) return isLinux ? LINUX_AUTO_BOX : null;
  if (!isLinux) return { width, height };
  return { width: Math.min(width, LINUX_AUTO_BOX.width), height: Math.min(height, LINUX_AUTO_BOX.height) };
}

/** Whether a representation fills the box without being stretched: it reaches the side its shape meets first. */
const fills = (representation: Representation, box: PlayerBox) =>
  (representation.width ?? 0) >= box.width * FILL_TOLERANCE ||
  (representation.height ?? 0) >= box.height * FILL_TOLERANCE;

const isHdrTrack = (track: DashVideoTrack) => (track.id ?? "").includes("-hdr");

const topHeight = (track: DashVideoTrack) =>
  Math.max(0, ...(track.bitrateList ?? []).map((representation) => representation.height ?? 0));

/**
 * The set Auto climbs in: an SDR set that can fill the player, or the one reaching the
 * highest resolution when none can or the player's size is unknown. Sets that tie go to the
 * preferred codec, then to the one that decodes most widely, so a player that 1080p fills
 * stays on H.264 and only a larger one moves to the VP9 or AV1 set.
 */
export function pickAutoVideoTrack(
  tracks: DashVideoTrack[],
  preferredCodec: string,
  box: PlayerBox | null = null,
): DashVideoTrack | null {
  const sdr = tracks.filter((track) => !isHdrTrack(track));
  const pool = sdr.length > 0 ? sdr : tracks;
  const top = Math.max(0, ...pool.map(topHeight));
  const order = (track: DashVideoTrack) =>
    (preferredCodec !== "Auto" && codecMatches(track.codec, preferredCodec) ? 0 : 1) * 10 + codecRank(track.codec);
  const filling = box
    ? pool.filter((track) => (track.bitrateList ?? []).some((representation) => fills(representation, box)))
    : [];
  const candidates = filling.length > 0 ? filling : pool.filter((track) => topHeight(track) === top);
  return candidates.sort((left, right) => order(left) - order(right))[0] ?? null;
}

/**
 * The set Auto uses while a video plays. A set that already fills the player is kept, even
 * when another would be picked from scratch: changing codec in the middle of a video is a
 * risk that only a picture too small for the player is worth.
 */
export function settleAutoVideoTrack(
  tracks: DashVideoTrack[],
  preferredCodec: string,
  box: PlayerBox | null,
  currentRepresentationId: string | null,
): DashVideoTrack | null {
  const current = tracks.find((track) =>
    (track.bitrateList ?? []).some((representation) => representation.id === currentRepresentationId),
  );
  const keeps =
    !!current && !!box && !isHdrTrack(current) && (current.bitrateList ?? []).some((item) => fills(item, box));
  return keeps ? current : pickAutoVideoTrack(tracks, preferredCodec, box);
}

/**
 * The bitrate Auto may climb to in `track`, in kbps for dash.js's `maxBitrate`: that of the
 * smallest representation that fills the player. -1, dash.js's "no limit", when none does.
 */
export function autoBitrateCapKbps(track: DashVideoTrack | null, box: PlayerBox | null): number {
  if (!track || !box) return -1;
  const smallest = (track.bitrateList ?? [])
    .filter((representation) => fills(representation, box) && (representation.bandwidth ?? 0) > 0)
    .sort((left, right) => (left.bandwidth ?? 0) - (right.bandwidth ?? 0))[0];
  return smallest?.bandwidth ? Math.ceil(smallest.bandwidth / 1000) : -1;
}

/** Where to move so ABR takes over in the Auto set; null when it is already playing there. */
export function autoRepresentationToSwitchTo(
  autoTrack: DashVideoTrack | null,
  current: RepresentationRef | null | undefined,
): string | null {
  const list = autoTrack?.bitrateList ?? [];
  if (list.length === 0 || !current || list.some((item) => item.id === String(current.id))) return null;
  const nearest = [...list].sort(
    (left, right) =>
      Math.abs((left.height ?? 0) - (current.height ?? 0)) - Math.abs((right.height ?? 0) - (current.height ?? 0)),
  )[0];
  return nearest?.id ?? null;
}

/**
 * Every representation in every set. dash.js's own lists only cover the set it
 * is playing, and a manual pick can cross sets.
 */
export function allVideoRepresentations(tracks: DashVideoTrack[]) {
  return tracks.flatMap((track) =>
    (track.bitrateList ?? [])
      .filter((item): item is typeof item & { id: string } => !!item.id)
      .map((item) => ({
        id: item.id,
        height: item.height,
        width: item.width,
        bandwidth: item.bandwidth,
        codecs: track.codec ?? undefined,
        mimeType: track.mimeType ?? undefined,
      })),
  );
}

/**
 * What plays when the chosen row can't be decoded here, such as a preference that
 * landed on HDR VP9 in WebKit: the nearest height, rather than the top of a list
 * that starts at 8K.
 */
export function nearestSupportedQuality(
  chosen: StreamVariant | undefined,
  supported: StreamVariant[],
): StreamVariant | undefined {
  if (!chosen) return undefined;
  return [...supported]
    .filter((quality) => !quality.qualityLabel?.includes("HDR") || chosen.qualityLabel?.includes("HDR"))
    .sort((left, right) => Math.abs((left.height ?? 0) - (chosen.height ?? 0)) - Math.abs((right.height ?? 0) - (chosen.height ?? 0)))[0];
}

const variantFor = (representation: RepresentationRef, qualities: StreamVariant[]) =>
  qualities.find((quality) => quality.id === String(representation.id));

/**
 * YouTube's name for a representation. Its raw height gives "960p" for a 2:1 film
 * that YouTube and the quality menu call 1080p.
 */
export function representationLabel(representation: RepresentationRef, qualities: StreamVariant[]): string {
  return variantFor(representation, qualities)?.qualityLabel ?? `${representation.height ?? 0}p`;
}

export function representationLabelWithCodec(
  representation: RepresentationRef,
  qualities: StreamVariant[],
  fallbackLabel: string,
): string {
  const variant = variantFor(representation, qualities);
  const label = variant?.qualityLabel ?? (representation.height ? `${representation.height}p` : fallbackLabel);
  const codec = videoCodecLabel(variant?.mimeType ?? representation.codecs ?? representation.mimeType);
  return codec ? `${label} (${codec})` : label;
}

export function droppedLastAdaptationSet(event: unknown): boolean {
  const remaining = (event as { remainingAdaptationSets?: unknown[] } | null)?.remainingAdaptationSets;
  return !remaining || remaining.length === 0;
}
