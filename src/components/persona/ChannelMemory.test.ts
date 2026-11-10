import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/youtube', () => ({ getChannelDetails: vi.fn() }));

import { ChannelMemory } from './ChannelMemory';
import type { UserBrain } from '../../lib/api/recommendation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brain = { channel_scores: { kept: 0.9, gone: 0.8 }, blocked_channels: ['gone'] } as unknown as UserBrain;

async function render(onBlockChannel?: (id: string, name: string) => void) {
  const host = document.createElement('div');
  await act(async () => createRoot(host).render(createElement(ChannelMemory, { brain, onBlockChannel })));
  return host;
}

describe('ChannelMemory', () => {
  it('leaves out blocked channels and blocks from a row', async () => {
    const onBlock = vi.fn();
    const host = await render(onBlock);
    expect(host.textContent).toContain('kept');
    expect(host.textContent).not.toContain('gone');
    await act(async () => host.querySelector('button')?.click());
    expect(onBlock).toHaveBeenCalledWith('kept', 'kept');
  });

  it('offers no block on a read-only profile', async () => {
    expect((await render()).querySelector('button')).toBeNull();
  });
});
