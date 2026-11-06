import { describe, expect, it } from 'vitest';

import { musicCardWidth } from './useMusicCardWidth';

describe('musicCardWidth', () => {
  it('is smaller for Small, and Big for anything else', () => {
    expect(musicCardWidth('small')).toContain('w-28');
    expect(musicCardWidth('big')).toContain('w-40');
    expect(musicCardWidth('')).toBe(musicCardWidth('big'));
  });
});
