import { describe, expect, it } from 'vitest';

import { mergeSuggestions, suggestionSeeds } from './musicCollectionSuggestions';
import type { SongItem } from '../types/music';

const song = (id: string) => ({ id, videoId: id } as SongItem);

describe('suggestionSeeds', () => {
  it('starts from the newest songs and moves on each round', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    expect(suggestionSeeds(list, 0)).toEqual(['e', 'd', 'c']);
    expect(suggestionSeeds(list, 1)).toEqual(['b', 'a', 'e']);
  });

  it('copes with short and empty lists', () => {
    expect(suggestionSeeds(['a'], 3)).toEqual(['a']);
    expect(suggestionSeeds([], 0)).toEqual([]);
  });
});

describe('mergeSuggestions', () => {
  it('takes from each seed in turn, skips what the list has and repeats', () => {
    const merged = mergeSuggestions([[song('a'), song('b')], [song('a'), song('c')], [song('x')]], new Set(['x']));
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops at ten', () => {
    const many = Array.from({ length: 30 }, (_, i) => song(`s${i}`));
    expect(mergeSuggestions([many], new Set())).toHaveLength(10);
  });
});
