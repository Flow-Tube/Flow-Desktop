import { describe, expect, it } from 'vitest';
import { highlightTerms } from './highlightTerms';

describe('highlightTerms', () => {
  it('marks every searched word, whatever its case', () => {
    expect(highlightTerms('Feed your Sourdough starter daily', 'sourdough STARTER')).toEqual([
      { text: 'Feed your ', match: false },
      { text: 'Sourdough', match: true },
      { text: ' ', match: false },
      { text: 'starter', match: true },
      { text: ' daily', match: false },
    ]);
  });

  it('ignores one-letter words and pattern characters', () => {
    expect(highlightTerms('a (b) c++', 'a c++')).toEqual([
      { text: 'a (b) ', match: false },
      { text: 'c++', match: true },
    ]);
    expect(highlightTerms('plain', '')).toEqual([{ text: 'plain', match: false }]);
  });
});
