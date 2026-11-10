import { describe, expect, it } from 'vitest';

import { recentDiscoveryQueries } from './LearningStats';

describe('recentDiscoveryQueries', () => {
  it('gives the last five, newest first', () => {
    const tokens = [['a'], ['b', 'c'], ['d'], ['e'], ['f'], ['g']];
    expect(recentDiscoveryQueries({ recent_query_tokens: tokens })).toEqual(['g', 'f', 'e', 'd', 'b c']);
  });

  it('copes with none', () => {
    expect(recentDiscoveryQueries({ recent_query_tokens: [] })).toEqual([]);
    expect(recentDiscoveryQueries({} as never)).toEqual([]);
  });
});
