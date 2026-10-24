export interface WordTimestamp {
  text: string;
  startTime: number; // ms
  endTime: number; // ms
}

export interface LyricsEntry {
  time: number; // ms; 0 = unsynced, ~1_000_000+ = plain-line placeholder
  text: string;
  words?: WordTimestamp[] | null;
  agent?: string | null;
  isBackground?: boolean;
  translation?: string | null;
}

/** Lyrics with the credit their source asks to be shown ("Source: Musixmatch"). */
export interface CreditedLyrics {
  entries: LyricsEntry[];
  source: string | null;
}

export interface LyricsProvider {
  name: string;
  getLyrics(
    id: string,
    title: string,
    artist: string,
    durationSec: number,
    album?: string | null,
  ): Promise<LyricsEntry[] | CreditedLyrics>;
}

export interface LyricsResult {
  entries: LyricsEntry[];
  provider: string;
  source?: string | null;
}
