import { useEffect, useState } from "react";
import { searchVideos } from "./api/youtube";
import { useDebounce } from "./useDebounce";
import type { SearchChannel } from "../types/video";

/** Channels matching `query`, from a channel-only search (about 20 per query). */
export function useChannelSearch(query: string, debounceMs = 400) {
  const debounced = useDebounce(query.trim(), debounceMs);
  const [channels, setChannels] = useState<SearchChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!debounced) {
      setChannels([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchVideos({ query: debounced, contentType: "channel" })
      .then((response) => {
        if (!cancelled) setChannels(response.channels ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Channel search failed", error);
        setChannels([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return { channels, loading, failed };
}
