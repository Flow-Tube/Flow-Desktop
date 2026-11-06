import type { RefObject } from "react";

import { getOriginalTitle } from "./api/youtube";
import { useNearViewport } from "./nearViewport";
import { createSessionLookup, useSessionLookup } from "./sessionLookup";
import { SETTINGS } from "./settings/schema";
import { isYoutubeVideoId } from "./thumbnails";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

// The backend remembers a final "no title" and answers a repeat without a request.
// Its null can also mean a rate limit or no network, which a later ask must retry.
const titles = createSessionLookup<string>(getOriginalTitle, {
  label: "original title",
  rememberAbsent: false,
});

export function useOriginalTitlesEnabled(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.ORIGINAL_TITLES] === "true");
}

/** What a request already answered, for a first frame that shows the right title. */
export function knownOriginalTitle(videoId: string): string | null {
  return titles.peek(videoId) ?? null;
}

export function loadOriginalTitle(videoId: string): Promise<string | null> {
  return titles.load(videoId);
}

/**
 * The title in the video's own language, or null to keep the shown one: switched off,
 * not a video, none known yet, or none to be had. A feed mounts all its cards, so a
 * card passes `nearRef` and asks only once it is near the screen; without one, the
 * caller is on screen and asks at once.
 */
export function useOriginalTitle(
  videoId: string | null | undefined,
  nearRef?: RefObject<Element | null>,
): string | null {
  const enabled = useOriginalTitlesEnabled();
  const id = enabled && isYoutubeVideoId(videoId) ? videoId : null;
  const known = id ? knownOriginalTitle(id) : null;
  const near = useNearViewport(nearRef, !!id && !known && !!nearRef);
  const answered = useSessionLookup(titles, id && !known && (near || !nearRef) ? id : null);
  return known ?? answered;
}
