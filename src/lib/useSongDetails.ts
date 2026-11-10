import { useEffect, useMemo, useState } from "react";

import { getVideoDetails } from "./api/youtube";
import { songDetailLines } from "./songDetails";
import type { SongItem } from "../types/music";
import type { VideoDetails } from "../types/video";

/** The lines to show for a song. They start from what is known and fill in; a failed lookup keeps those. */
export function useSongDetails(song: SongItem | null) {
  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const songId = song ? song.videoId ?? song.id : null;

  useEffect(() => {
    setDetails(null);
    if (!songId) return;
    let cancelled = false;
    setLoading(true);
    void getVideoDetails(songId)
      .then((next) => {
        if (!cancelled) setDetails(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const lines = useMemo(() => (song ? songDetailLines(song, details) : []), [song, details]);
  return { lines, loading };
}
