/**
 * How a lyrics search names a song, and how a provider's candidates are checked against it.
 * Credits and packaging ("feat. X", "Official Video") are dropped from the search. Version tags
 * ("Live", "Remix", "Sped Up") name a different recording, so they stay, and a candidate has to
 * carry the same ones: otherwise a live cut gets the studio version's timing.
 *
 * Port of Android's LyricsMatching.kt; the version and scoring rules follow LastWave-Native (GPL-3.0).
 */

export interface MatchSong {
  title: string;
  artist: string;
  durationSec: number;
}

/**
 * Exact title and artist agreement. A fuzzy title passes only with a close duration too. A
 * candidate with a different title, or a different artist when one is asked for, scores 0.
 */
export const MIN_SCORE = 5;

const EXACT_TITLE = 3;
const FUZZY_TITLE = 1;
const ARTIST = 2;
const CLOSE_DURATION = 3;
const NEAR_DURATION = 1;
const CLOSE_DURATION_SECONDS = 3;
const NEAR_DURATION_SECONDS = 10;

const FEAT_BRACKET = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const FEAT_TRAILING = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;
const PACKAGING_BRACKET =
  /\s*[([]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|visuali[sz]er|lyrics?\s*video|lyrics?|m\/?v|hd|hq|4k|clip|full\s*song|official)\s*[)\]]/gi;
const PACKAGING_SUFFIX = /\s*[-|]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|visuali[sz]er|lyrics?\s*video|lyrics?)\s*$/i;
const BRACKETED = /[([](.*?)[)\]]/g;
const DASH_SUFFIX = /\s+[-–—]\s+([^-–—([]+)$/;
const ARTIST_SPLIT = /\s*(?:,|&|\/|\bx\b|\band\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i;
const PRIMARY_ARTIST_SPLIT = /\s+(?:feat\.?|ft\.?|featuring|&|,|vs\.?)\s+/i;
const TOPIC_SUFFIX = /\s*-\s*Topic/gi;
const APOSTROPHES = /['’`]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const VERSION_KEYWORDS: Array<[RegExp, string]> = (
  [
    ["live", "live"],
    ["concert", "live"],
    ["session", "live"],
    ["unplugged", "unplugged"],
    ["acoustic", "acoustic"],
    ["remix", "remix"],
    ["cover", "cover"],
    ["karaoke", "karaoke"],
    ["instrumental", "instrumental"],
    ["slowed", "slowed"],
    ["sped up", "sped"],
    ["speed up", "sped"],
    ["spedup", "sped"],
    ["nightcore", "sped"],
    ["demo", "demo"],
    ["8d", "8d"],
  ] as const
).map(([keyword, tag]) => [new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i"), tag]);

export function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(FEAT_BRACKET, "")
    .replace(FEAT_TRAILING, "")
    .replace(PACKAGING_BRACKET, "")
    .replace(PACKAGING_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw.trim();
}

/** The first credited artist, which is the one every catalogue files the song under. */
export function cleanArtist(raw: string): string {
  return (raw.replace(TOPIC_SUFFIX, "").split(PRIMARY_ARTIST_SPLIT)[0] ?? "").trim();
}

export function versionTags(title: string): Set<string> {
  const segments = Array.from(title.matchAll(BRACKETED), (m) => m[1] ?? "");
  const dash = title.match(DASH_SUFFIX)?.[1];
  if (dash) segments.push(dash);
  const tags = new Set<string>();
  for (const segment of segments) {
    for (const [pattern, tag] of VERSION_KEYWORDS) if (pattern.test(segment)) tags.add(tag);
  }
  return tags;
}

export function sameVersion(requestTitle: string, candidateTitle: string): boolean {
  const a = versionTags(requestTitle);
  const b = versionTags(candidateTitle);
  return a.size === b.size && [...a].every((tag) => b.has(tag));
}

export function score(request: MatchSong, candidate: MatchSong): number {
  let total = titleScore(candidate.title, request.title);
  if (total === 0) return 0;
  if (artistMatches(candidate.artist, request.artist)) total += ARTIST;
  else if (request.artist.trim()) return 0;
  if (request.durationSec > 0 && candidate.durationSec > 0) {
    const gap = Math.abs(request.durationSec - candidate.durationSec);
    if (gap <= CLOSE_DURATION_SECONDS) total += CLOSE_DURATION;
    else if (gap <= NEAR_DURATION_SECONDS) total += NEAR_DURATION;
  }
  return total;
}

/**
 * Every candidate naming the same recording with a score at or above [MIN_SCORE], best first:
 * the highest score, then [preferred] ones, then the closest duration.
 */
export function ranked<T>(
  candidates: T[],
  request: MatchSong,
  describe: (candidate: T) => MatchSong,
  preferred: (candidate: T) => boolean = () => false,
): T[] {
  return candidates
    .map((candidate) => ({ candidate, song: describe(candidate) }))
    .filter(({ song }) => sameVersion(request.title, song.title))
    .map((row) => ({ ...row, score: score(request, row.song), preferred: preferred(row.candidate) }))
    .filter((row) => row.score >= MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.preferred) - Number(a.preferred) ||
        durationGap(request, a.song) - durationGap(request, b.song),
    )
    .map((row) => row.candidate);
}

/** The candidate naming the same recording, or null when none clears [MIN_SCORE]. */
export function best<T>(
  candidates: T[],
  request: MatchSong,
  describe: (candidate: T) => MatchSong,
  preferred?: (candidate: T) => boolean,
): T | null {
  return ranked(candidates, request, describe, preferred)[0] ?? null;
}

function durationGap(request: MatchSong, candidate: MatchSong): number {
  return request.durationSec > 0 && candidate.durationSec > 0
    ? Math.abs(request.durationSec - candidate.durationSec)
    : Number.MAX_SAFE_INTEGER;
}

function titleScore(candidate: string, request: string): number {
  const a = normalize(baseTitle(candidate));
  const b = normalize(baseTitle(request));
  if (!a || !b) return 0;
  if (a === b) return EXACT_TITLE;
  return similar(a, b, 0.7) ? FUZZY_TITLE : 0;
}

function artistMatches(candidate: string, request: string): boolean {
  const wanted = normalize(cleanArtist(request));
  if (!wanted || !candidate.trim()) return false;
  const credited = [candidate, ...candidate.split(ARTIST_SPLIT)];
  return credited
    .map(normalize)
    .filter(Boolean)
    .some((name) => name === wanted || similar(name, wanted, 0.6));
}

/** The title without its brackets and trailing "- ..." part, once versions are known to agree. */
function baseTitle(title: string): string {
  return cleanTitle(title).replace(BRACKETED, " ").replace(DASH_SUFFIX, "");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(APOSTROPHES, "").replace(NON_WORD, " ").trim();
}

function similar(a: string, b: string, minRatio: number): boolean {
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (ratio >= minRatio) return true;
  }
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return shared / union >= 0.5;
}
