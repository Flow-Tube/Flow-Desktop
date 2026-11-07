import { useCallback, useEffect, useState } from "react";

import { proxyArtworkLoop } from "./api/images";
import { artworkLoopFor, forgetArtworkLoop } from "./animatedArtwork";
import { SETTINGS } from "./settings/schema";
import { useBoolPref } from "./usePreference";
import type { SongItem } from "../types/music";

/** Tried at once, then 20 s and 60 s after the first failure: the service often answers 503 well under its rate limit. */
export const ATTEMPT_WAITS_MS = [0, 20_000, 40_000];

/**
 * The proxied loop for this song while the setting is on, or null. A third-party service, so any
 * failure simply leaves the still cover on screen; a failed lookup is tried again twice while the
 * song stays on screen.
 */
export function useAnimatedArtwork(song: SongItem) {
  const [enabled] = useBoolPref(SETTINGS.MUSIC_ANIMATED_ARTWORK);
  const [loopUrl, setLoopUrl] = useState<string | null>(null);
  const songId = song.videoId ?? song.id;

  useEffect(() => {
    setLoopUrl(null);
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (index: number) => {
      timer = setTimeout(() => {
        void artworkLoopFor(song)
          .then((url) => (url ? proxyArtworkLoop(url) : null))
          .then(
            (url) => {
              if (!cancelled) setLoopUrl(url);
            },
            () => {
              if (!cancelled && index + 1 < ATTEMPT_WAITS_MS.length) attempt(index + 1);
            },
          );
      }, ATTEMPT_WAITS_MS[index]);
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // A queue update gives the same song a new object, which must not restart its loop.
  }, [enabled, songId]);

  const onFailed = useCallback(() => {
    forgetArtworkLoop(song);
    setLoopUrl(null);
  }, [song]);

  return { loopUrl, onFailed };
}
