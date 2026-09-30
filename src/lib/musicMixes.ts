import { getMusicRelatedTyped } from './api/music';
import { audioMusicOnly, ranked } from './musicRecall';
import type { DailyMixSeed, SongItem } from '../types/music';

const MIX_SEEDS = 3;

export function dailyMixId(mix: DailyMixSeed): string {
  const key = [...mix.seedTrackIds].sort().join('|');
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `mix-${(hash >>> 0).toString(36)}`;
}

/**
 * The route carries the label and seeds, so a mix link keeps working after the
 * brain regroups its clusters. Local ids never reach Innertube.
 */
export function dailyMixRoute(mix: DailyMixSeed): string {
  const query = new URLSearchParams({
    label: mix.label,
    seeds: mix.seedTrackIds.slice(0, MIX_SEEDS).join(','),
  });
  return `/music/mix/${dailyMixId(mix)}?${query}`;
}

export function mixFromRoute(search: URLSearchParams): DailyMixSeed | null {
  const seedTrackIds = (search.get('seeds') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const label = search.get('label')?.trim();
  return label && seedTrackIds.length ? { label, seedTrackIds } : null;
}

export async function expandDailyMix(mix: DailyMixSeed): Promise<SongItem[]> {
  const pages = await Promise.all(mix.seedTrackIds.slice(0, MIX_SEEDS)
    .map((id) => getMusicRelatedTyped(id).catch(() => null)));
  return ranked(audioMusicOnly(pages.flatMap((page) => page?.songs ?? [])), 'discover');
}
