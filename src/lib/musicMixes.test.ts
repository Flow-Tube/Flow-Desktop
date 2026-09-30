import { describe, expect, it } from 'vitest';

import { dailyMixId, dailyMixRoute, mixFromRoute } from './musicMixes';

describe('dailyMixId', () => {
  it('keeps a local mix route stable when seed order changes', () => {
    const first = dailyMixId({ label: 'Evening', seedTrackIds: ['a', 'b', 'c'] });
    const reordered = dailyMixId({ label: 'Evening', seedTrackIds: ['c', 'a', 'b'] });
    const different = dailyMixId({ label: 'Evening', seedTrackIds: ['a', 'b', 'd'] });
    expect(reordered).toBe(first);
    expect(different).not.toBe(first);
    expect(first).toMatch(/^mix-[a-z0-9]+$/);
  });
});

describe('daily mix routes', () => {
  it('round-trip the label and seeds so the link survives brain changes', () => {
    const mix = { label: 'Rock & roll', seedTrackIds: ['a', 'b', 'c', 'd'] };
    const route = dailyMixRoute(mix);
    expect(route.startsWith(`/music/mix/${dailyMixId(mix)}?`)).toBe(true);
    const search = new URLSearchParams(route.split('?')[1]);
    expect(mixFromRoute(search)).toEqual({ label: 'Rock & roll', seedTrackIds: ['a', 'b', 'c'] });
  });

  it('rejects routes without seeds', () => {
    expect(mixFromRoute(new URLSearchParams('label=Only'))).toBeNull();
  });
});
