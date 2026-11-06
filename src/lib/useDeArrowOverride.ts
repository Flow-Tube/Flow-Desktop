import { getDeArrowOverride, type DeArrowOverride } from "./api/foss";
import { createSessionLookup, useSessionLookup } from "./sessionLookup";
import { isYoutubeVideoId } from "./thumbnails";

const overrides = createSessionLookup<DeArrowOverride>(getDeArrowOverride, {
  label: "DeArrow override",
  rememberAbsent: true,
});

/** The cache and in-flight dedupe under the hook, exported so their sharing can be tested. */
export function loadDeArrowOverride(videoId: string): Promise<DeArrowOverride | null> {
  return overrides.load(videoId);
}

/** Returns null when disabled, when the id is not a video, or until it resolves. */
export function useDeArrowOverride(
  videoId: string | null | undefined,
  enabled: boolean,
): DeArrowOverride | null {
  return useSessionLookup(overrides, enabled && isYoutubeVideoId(videoId) ? videoId : null);
}
