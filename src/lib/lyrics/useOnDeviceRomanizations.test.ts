import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const romanizeLyrics = vi.fn();
vi.mock('../api/lyrics', () => ({ romanizeLyrics: (...args: unknown[]) => romanizeLyrics(...args) }));

import { useOnDeviceRomanizations } from './useOnDeviceRomanizations';
import type { LyricsEntry } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function latest(lines: LyricsEntry[], enabled: boolean) {
  let value: ReadonlyArray<string | null> = [];
  const Probe = () => {
    value = useOnDeviceRomanizations(lines, enabled);
    return null;
  };
  await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)));
  return value;
}

describe('useOnDeviceRomanizations', () => {
  beforeEach(() => {
    romanizeLyrics.mockReset();
  });

  it('asks for the lines when on', async () => {
    romanizeLyrics.mockResolvedValue(['saranghae']);
    expect(await latest([{ time: 0, text: '사랑해' }], true)).toEqual(['saranghae']);
    expect(romanizeLyrics).toHaveBeenCalledWith(['사랑해']);
  });

  it('asks nothing when off, empty, or the source already romanized every line', async () => {
    await latest([{ time: 0, text: 'a' }], false);
    await latest([], true);
    await latest([{ time: 0, text: '사랑해', romanization: 'saranghae' }], true);
    expect(romanizeLyrics).not.toHaveBeenCalled();
  });

  it('stays empty when the call fails', async () => {
    romanizeLyrics.mockRejectedValue(new Error('no'));
    expect(await latest([{ time: 0, text: 'a' }], true)).toEqual([]);
  });
});
