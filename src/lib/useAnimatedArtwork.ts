import { useCallback, useEffect, useState } from "react";

import { proxyArtworkLoop } from "./api/images";
import { artworkLoopFor, forgetArtworkLoop } from "./animatedArtwork";
import { SETTINGS } from "./settings/schema";
import { useBoolPref } from "./usePreference";
import type { SongItem } from "../types/music";

/**
 * The proxied loop for this song while the setting is on, or null. A third-party service, so any
 * failure simply leaves the still cover on screen.
 */
export function useAnimatedArtwork(song: SongItem) {
  const [enabled] = useBoolPref(SETTINGS.MUSIC_ANIMATED_ARTWORK);
  const [loopUrl, setLoopUrl] = useState<string | null>(null);
  const songId = song.videoId ?? song.id;

  useEffect(() => {
    setLoopUrl(null);
    if (!enabled) return;
    let cancelled = false;
    void artworkLoopFor(song)
      .then((url) => (url ? proxyArtworkLoop(url) : null))
      .then((url) => {
        if (!cancelled) setLoopUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // A queue update gives the same song a new object, which must not restart its loop.
  }, [enabled, songId]);

  const onFailed = useCallback(() => {
    forgetArtworkLoop(song);
    setLoopUrl(null);
  }, [song]);

  return { loopUrl, onFailed };
}
