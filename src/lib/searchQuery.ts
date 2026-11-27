/**
 * The longest search Flow runs: YouTube Music's limit, the larger of the two.
 * The backend cuts a YouTube search to 3,000 characters on its own.
 */
export const MAX_SEARCH_CHARS = 5000;

/**
 * The YouTube suggest host answers HTTP 400 to longer text, so Flow doesn't ask it.
 * The backend's `MAX_SUGGEST_CHARS` is the same number.
 */
export const MAX_SUGGEST_CHARS = 100;

/** `query` trimmed and cut to the longest search Flow runs, between characters. */
export function clipSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= MAX_SEARCH_CHARS) return trimmed;
  return Array.from(trimmed).slice(0, MAX_SEARCH_CHARS).join("").trimEnd();
}

/** Characters as people count them, so an emoji counts once, as the backend counts it. */
export function searchLength(query: string): number {
  return Array.from(query).length;
}
