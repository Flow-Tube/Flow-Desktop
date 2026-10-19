import { describe, expect, it } from 'vitest';
import { toGraphicsMode } from './useGraphicsMode';

describe('toGraphicsMode', () => {
  it('keeps the modes the backend knows', () => {
    expect(toGraphicsMode('automatic')).toBe('automatic');
    expect(toGraphicsMode('compatible')).toBe('compatible');
    expect(toGraphicsMode('safe')).toBe('safe');
  });

  it('falls back to automatic for anything else', () => {
    expect(toGraphicsMode('fast')).toBe('automatic');
    expect(toGraphicsMode(undefined)).toBe('automatic');
  });
});
