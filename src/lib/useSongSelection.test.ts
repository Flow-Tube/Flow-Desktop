import { describe, expect, it } from 'vitest';

import { selectionRange } from './useSongSelection';

describe('selectionRange', () => {
  const shown = ['a', 'b', 'c', 'd'];

  it('covers both directions from the last pick', () => {
    expect(selectionRange(shown, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectionRange(shown, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('is just the song when there is no last pick on screen', () => {
    expect(selectionRange(shown, null, 'c')).toEqual(['c']);
    expect(selectionRange(shown, 'gone', 'c')).toEqual(['c']);
  });
});
