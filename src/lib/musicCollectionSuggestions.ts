import type { SongItem } from '../types/music';

export const SUGGESTION_SEEDS_PER_ROUND = 3;
const SUGGESTIONS_SHOWN = 10;

/** Songs spread over the list, starting from its end, where the newest additions sit. */
export function suggestionSeeds(videoIds: string[], round: number): string[] {
  const usable = [...new Set(videoIds)].reverse();
  if (usable.length === 0) return [];
  const count = Math.min(SUGGESTION_SEEDS_PER_ROUND, usable.length);
  const seeds = Array.from(
    { length: count },
    (_, offset) => usable[(round * SUGGESTION_SEEDS_PER_ROUND + offset) % usable.length] as string,
  );
  return [...new Set(seeds)];
}

/** Takes from each seed in turn so one artist's neighbourhood can't fill the list. */
export function mergeSuggestions(related: SongItem[][], exclude: Set<string>): SongItem[] {
  const longest = Math.max(0, ...related.map((songs) => songs.length));
  const seen = new Set(exclude);
  const merged: SongItem[] = [];
  for (let index = 0; index < longest && merged.length < SUGGESTIONS_SHOWN; index += 1) {
    for (const songs of related) {
      const song = songs[index];
      if (!song || merged.length >= SUGGESTIONS_SHOWN) continue;
      const id = song.videoId ?? song.id;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(song);
    }
  }
  return merged;
}
