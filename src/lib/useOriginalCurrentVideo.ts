import { useEffect, useLayoutEffect, useState } from "react";

import { isYoutubeVideoId } from "./thumbnails";
import { knownOriginalTitle, loadOriginalTitle, useOriginalTitlesEnabled } from "./useOriginalTitle";
import { usePlayerStore } from "../store/usePlayerStore";
import type { VideoDetails } from "../types/video";

/**
 * Keeps the playing video on its original title. The player overlay, history, pop-out,
 * tab label, media controls and Discord all read this one value.
 *
 * A stub from a cold open is left alone: the watch page fills in its channel and
 * thumbnail only while its title is still empty, and that title comes from the player
 * response, which is not translated.
 */
export function useOriginalCurrentVideo(videoDetails: VideoDetails | null | undefined) {
  const enabled = useOriginalTitlesEnabled();
  const videoId = usePlayerStore((s) => s.currentVideo?.id ?? null);
  const hasTitle = usePlayerStore((s) => !!s.currentVideo?.title);
  const enrichCurrentVideo = usePlayerStore((s) => s.enrichCurrentVideo);
  const [refusedId, setRefusedId] = useState<string | null>(null);
  const active = enabled && hasTitle && isYoutubeVideoId(videoId);

  // A layout effect, so a title a card already looked up replaces the translated one
  // before the watch page paints.
  useLayoutEffect(() => {
    if (!active || !videoId) return;
    const known = knownOriginalTitle(videoId);
    if (known) {
      enrichCurrentVideo(videoId, { title: known });
      return;
    }
    let cancelled = false;
    void loadOriginalTitle(videoId).then((title) => {
      if (cancelled) return;
      if (title) enrichCurrentVideo(videoId, { title });
      else setRefusedId(videoId);
    });
    return () => {
      cancelled = true;
    };
  }, [active, videoId, enrichCurrentVideo]);

  // Embedding-off videos have no oEmbed answer, but the player response names them too.
  const detailsTitle = videoDetails?.id === videoId ? videoDetails?.title : null;
  useEffect(() => {
    if (active && videoId && refusedId === videoId && detailsTitle) {
      enrichCurrentVideo(videoId, { title: detailsTitle });
    }
  }, [active, videoId, refusedId, detailsTitle, enrichCurrentVideo]);
}
