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
 * With `musicEnabled` off, YouTube Music is never asked.
 */
export function useSearchSuggestions(
  query: string,
  region: string | null | undefined,
  enabled = true,
  musicEnabled = true,
) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [musicItems, setMusicItems] = useState<YTItem[]>([]);

  // Keyed on the trimmed text: a space typed after a word asks nothing new, so the
  // request already out for that word keeps running instead of being thrown away.
  const q = query.trim();

  useEffect(() => {
    if (!enabled || q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setMusicItems([]);
      return;
    }

    // Clearing the timeout does not cancel a request already in flight, and replies can
    // land out of order; without this guard an older keystroke's answer would win.
    let current = true;
    if (!musicEnabled) setMusicItems([]);
    // A failed request leaves the rows on screen: they are closer to the text than an
    // empty list, and the next keystroke asks again.
    const timer = setTimeout(() => {
      getSearchSuggestions(q, region)
        .then((results) => {
          if (current) setSuggestions(results);
        })
        .catch((error) => console.warn("Suggestions error", error));
      if (!musicEnabled) return;
      getMusicSearchSuggestions(q)
        .then((results) => {
          if (current) setMusicItems(results.recommendedItems);
        })
        // Music entities are a bonus beside the text suggestions; their absence needs no notice.
        .catch(() => undefined);
    }, DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, region, enabled, musicEnabled]);

  return { suggestions, musicItems };
}
