import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canKeepScreenOn, useKeepScreenOn } from './useKeepScreenOn';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockWakeLock() {
  const release = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue({ release });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, release };
}

function mount(active: boolean) {
  const Probe = ({ on }: { on: boolean }) => {
    useKeepScreenOn(on);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  const render = (on: boolean) => act(async () => root.render(createElement(Probe, { on })));
  return { first: render(active), render };
}

describe('useKeepScreenOn', () => {
  afterEach(() => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  it('holds the lock while active and lets go after', async () => {
    const { request, release } = mockWakeLock();
    expect(canKeepScreenOn()).toBe(true);
    const view = mount(true);
    await view.first;
    expect(request).toHaveBeenCalledWith('screen');
    await view.render(false);
    expect(release).toHaveBeenCalled();
  });

  it('asks for nothing while inactive, and copes with no wake lock at all', async () => {
    const { request } = mockWakeLock();
    await mount(false).first;
    expect(request).not.toHaveBeenCalled();
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    expect(canKeepScreenOn()).toBe(false);
    await mount(true).first;
  });

  it('survives a refusal', async () => {
    const { request } = mockWakeLock();
    request.mockRejectedValue(new Error('denied'));
    await mount(true).first;
    expect(request).toHaveBeenCalled();
  });
});
