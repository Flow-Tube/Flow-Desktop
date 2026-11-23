import { describe, expect, it } from 'vitest';

import { musicCardMaxPx, musicCardWidth } from './useMusicCardWidth';

describe('musicCardWidth', () => {
  it('is smaller for Small, and Big for anything else', () => {
    expect(musicCardWidth('small')).toContain('w-28');
    expect(musicCardWidth('big')).toContain('w-40');
    expect(musicCardWidth('')).toBe(musicCardWidth('big'));
  });
});

describe('musicCardMaxPx', () => {
  it('matches the widest class of each size', () => {
    expect(musicCardWidth('small')).toContain(`lg:w-${musicCardMaxPx('small') / 4}`);
    expect(musicCardWidth('big')).toContain(`lg:w-${musicCardMaxPx('big') / 4}`);
  });
});
