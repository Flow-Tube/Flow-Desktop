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

const isHdrTrack = (track: DashVideoTrack) => (track.id ?? "").includes("-hdr");

const topHeight = (track: DashVideoTrack) =>
  Math.max(0, ...(track.bitrateList ?? []).map((representation) => representation.height ?? 0));

/**
 * The set Auto climbs in: the SDR set reaching the highest resolution, so a fast
 * network isn't held back. Sets that tie go to the preferred codec, then to the
 * one that decodes most widely, so a video that tops out at 1080p stays on H.264.
 */
export function pickAutoVideoTrack(tracks: DashVideoTrack[], preferredCodec: string): DashVideoTrack | null {
  const sdr = tracks.filter((track) => !isHdrTrack(track));
  const pool = sdr.length > 0 ? sdr : tracks;
  const top = Math.max(0, ...pool.map(topHeight));
  const order = (track: DashVideoTrack) =>
    (preferredCodec !== "Auto" && codecMatches(track.codec, preferredCodec) ? 0 : 1) * 10 + codecRank(track.codec);
  return pool.filter((track) => topHeight(track) === top).sort((left, right) => order(left) - order(right))[0] ?? null;
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
