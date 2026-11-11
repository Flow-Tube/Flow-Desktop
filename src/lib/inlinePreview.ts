import { selectPreferredCaptionId } from "./settings/playerRuntime";
import { pickDirectUrl, pickDirectVariant } from "./useShortStream";
import type { CaptionTrack, StreamInfo } from "../types/video";

/** When a card starts resolving its stream, and when it starts playing it. */
export const INLINE_RESOLVE_DELAY_MS = 300;
export const INLINE_PLAY_DELAY_MS = 600;

export type InlinePreviewSource = { kind: "dash"; url: string } | { kind: "direct"; url: string };

/**
 * What a card plays. DASH lets dash.js pick the quality as the player's Auto does; without it,
 * a stream with its sound in the same file, so unmuting needs nothing else.
 */
export function inlinePreviewSource(info: StreamInfo): InlinePreviewSource | null {
  if (info.dashManifestUrl) return { kind: "dash", url: info.dashManifestUrl };
  const direct = pickDirectVariant(info, "auto")?.localUrl ?? pickDirectUrl(info);
  return direct ? { kind: "direct", url: direct } : null;
}

/**
 * The captions a muted card shows: the viewer's language when the video has it, else the
 * video's own, auto-generated or not, as YouTube does for a muted preview.
 */
export function inlinePreviewCaptionId(captions: CaptionTrack[], preferredLanguage: string): string | null {
  return selectPreferredCaptionId(captions, preferredLanguage)
    ?? captions.find((caption) => !caption.isTranslation)?.id
    ?? null;
}
