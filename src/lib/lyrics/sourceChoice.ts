/**
 * Which lyrics a downloaded song shows when the user picked one in "Choose lyrics source":
 * the copy saved with the download, or the online providers. Songs without a choice show the
 * saved copy first and let the providers replace it only with something better.
 */
export type LyricsSourceChoice = "downloaded" | "online";

const STORAGE_KEY = "flow_lyrics_source_choice";
/** Oldest choices are dropped past this, so the map cannot grow without limit. */
const MAX_CHOICES = 500;

let choices: Map<string, LyricsSourceChoice> | null = null;

function load(): Map<string, LyricsSourceChoice> {
  if (choices) return choices;
  choices = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      for (const [videoId, choice] of Object.entries(parsed)) {
        if (choice === "downloaded" || choice === "online") choices.set(videoId, choice);
      }
    }
  } catch {
    // Unreadable storage only means no song has a choice yet.
  }
  return choices;
}

function save(map: Map<string, LyricsSourceChoice>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // The choice still holds for this session.
  }
}

export function getLyricsSourceChoice(videoId: string): LyricsSourceChoice | null {
  return load().get(videoId) ?? null;
}

/** Records the choice, or with `null` forgets it so the song is back to automatic. */
export function setLyricsSourceChoice(videoId: string, choice: LyricsSourceChoice | null): void {
  const map = load();
  map.delete(videoId);
  if (choice) map.set(videoId, choice);
  while (map.size > MAX_CHOICES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  save(map);
}
