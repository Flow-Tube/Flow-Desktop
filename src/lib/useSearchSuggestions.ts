import { useEffect, useState } from "react";
import { getSearchSuggestions } from "./api/youtube";
import { getMusicSearchSuggestions } from "./api/music";
import type { SearchSuggestion } from "../types/video";
import type { YTItem } from "../types/music";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Text suggestions from YouTube and tappable entities from YouTube Music for `query`.
 * The two answers are shown as each arrives, so a slow one never holds up the other.
 */
export function useSearchSuggestions(query: string, region: string | null | undefined) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [musicItems, setMusicItems] = useState<YTItem[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setMusicItems([]);
      return;
    }

    // Clearing the timeout does not cancel a request already in flight, and replies can
    // land out of order; without this guard an older keystroke's answer would win.
    let current = true;
    const timer = setTimeout(() => {
      getSearchSuggestions(q, region)
        .then((results) => {
          if (current) setSuggestions(results);
        })
        .catch((error) => {
          console.warn("Suggestions error", error);
          if (current) setSuggestions([]);
        });
      getMusicSearchSuggestions(q)
        .then((results) => {
          if (current) setMusicItems(results.recommendedItems);
        })
        .catch(() => {
          // Music entities are a bonus beside the text suggestions; their absence needs no notice.
          if (current) setMusicItems([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, region]);

  return { suggestions, musicItems };
}
