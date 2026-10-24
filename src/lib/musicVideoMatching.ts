/**
 * Picks a song's official music video out of a video search, ported from Flow
 * Android's `MusicVideoMatching`. Signed-out responses never carry YouTube
 * Music's own song-to-video link, so the match is the artist's official upload
 * of the same title, never a live take, remix, cover or an "official audio" upload.
 */
import type { SongItem } from "../types/music";

const OFFICIAL_VIDEO = "MUSIC_VIDEO_TYPE_OMV";
const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const FEATURING = /\s+(feat\.?|ft\.?|featuring)\s.*$/;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const TOPIC_SUFFIX = " - topic";
const MAX_EXTRA_SECONDS = 60;

// An official upload of the same title in one of these forms is a different recording or no video.
const OTHER_VERSIONS = [
  "live", "remix", "cover", "karaoke", "instrumental", "sped up", "slowed", "reverb", "acoustic",
  "teaser", "trailer", "nightcore", "extended", "audio", "visualizer", "visualiser", "behind the scenes",
];

/** Lower case without accents, as Android's `foldForSearch`. */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

export function musicArtistKey(name: string): string {
  const folded = foldForSearch(name);
  return (folded.endsWith(TOPIC_SUFFIX) ? folded.slice(0, -TOPIC_SUFFIX.length) : folded).trim();
}

/** "The Weeknd - Blinding Lights (Official Video)" and "Blinding Lights" share a key when the artist is The Weeknd. */
export function musicTitleKey(title: string, artists: string[] = []): string {
  let folded = foldForSearch(title).replace(BRACKETS, "").replace(FEATURING, "").trim();
  for (const artist of artists.map(musicArtistKey)) {
    const prefix = `${artist} - `;
    if (artist && folded.startsWith(prefix)) folded = folded.slice(prefix.length);
  }
  return folded.replace(NON_WORD, " ").trim();
}

const isWordIn = (word: string, title: string) => ` ${foldForSearch(title).replace(NON_WORD, " ")} `.includes(` ${word} `);

// An intro or outro makes a video longer than its song, but not twice as long and never half.
function plausibleLength(songSeconds: number | null, videoSeconds: number | null): boolean {
  if (!songSeconds || songSeconds <= 0 || !videoSeconds || videoSeconds <= 0) return true;
  return videoSeconds * 2 >= songSeconds && videoSeconds <= songSeconds * 2 + MAX_EXTRA_SECONDS;
}

function sameArtist(song: SongItem, candidate: SongItem): boolean {
  const ids = new Set(song.artists.map((a) => a.id).filter((id): id is string => Boolean(id)));
  if (candidate.artists.some((a) => a.id && ids.has(a.id))) return true;
  const names = new Set(song.artists.map((a) => musicArtistKey(a.name)));
  return candidate.artists.some((a) => names.has(musicArtistKey(a.name)));
}

export function isOfficialVideoOf(song: SongItem, candidate: SongItem): boolean {
  const names = song.artists.map((a) => a.name);
  return (
    candidate.musicVideoType === OFFICIAL_VIDEO &&
    sameArtist(song, candidate) &&
    musicTitleKey(candidate.title, names) === musicTitleKey(song.title, names) &&
    OTHER_VERSIONS.every((word) => !isWordIn(word, candidate.title) || isWordIn(word, song.title)) &&
    plausibleLength(song.duration, candidate.duration)
  );
}

export function pickOfficialVideo(song: SongItem, candidates: SongItem[]): SongItem | null {
  return candidates.find((candidate) => isOfficialVideoOf(song, candidate)) ?? null;
}
