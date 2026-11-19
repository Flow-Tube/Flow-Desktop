import type { RefObject } from "react";
import { getDeArrowOverride, type DeArrowOverride } from "./api/foss";
import { useNearViewport } from "./nearViewport";
import { createSessionLookup, useSessionLookupState } from "./sessionLookup";
import { isYoutubeVideoId } from "./thumbnails";

const overrides = createSessionLookup<DeArrowOverride>(getDeArrowOverride, {
  label: "DeArrow override",
  rememberAbsent: true,
});

/** The cache and in-flight dedupe under the hook, exported so their sharing can be tested. */
export function loadDeArrowOverride(videoId: string): Promise<DeArrowOverride | null> {
  return overrides.load(videoId);
}

/**
 * Returns null when disabled, when the id is not a video, or until it resolves. A feed mounts
 * far more cards than it shows, so a card passes `nearRef` and asks only once it is near the
 * screen. Without one, the caller is on screen and asks at once. An answer already held is
 * returned either way.
 */
export function useDeArrowOverride(
  videoId: string | null | undefined,
  enabled: boolean,
  nearRef?: RefObject<Element | null>,
): DeArrowOverride | null {
  return useDeArrowOverrideState(videoId, enabled, nearRef).override;
}

/**
 * The override, and whether DeArrow has had its say: true once it answered or failed, and
 * always when there is nothing to ask. A card waits for that before asking for the original
 * title, which a DeArrow title would replace anyway.
 */
export function useDeArrowOverrideState(
  videoId: string | null | undefined,
  enabled: boolean,
  nearRef?: RefObject<Element | null>,
): { override: DeArrowOverride | null; settled: boolean } {
  const id = enabled && isYoutubeVideoId(videoId) ? videoId : null;
  const known = !!id && overrides.peek(id) !== undefined;
  const near = useNearViewport(nearRef, !!id && !known && !!nearRef);
  const { value, settled } = useSessionLookupState(overrides, id && (known || near || !nearRef) ? id : null);
  return { override: value, settled: !id || settled };
}
