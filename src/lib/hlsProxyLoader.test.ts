import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ calls: [] as Array<{ url?: string; answer: (url: string) => void }> }));
vi.mock('hls.js', () => ({
  default: {
    DefaultConfig: {
      loader: class {
        load(context: { url?: string }, _config: unknown, callbacks: { onSuccess: (response: { url?: string }) => void }) {
          loaded.calls.push({ url: context.url, answer: (url) => callbacks.onSuccess({ url }) });
        }
      },
    },
  },
}));

import { hlsProxyLoader, hlsProxyPrefix, throughProxy, upstreamOf } from './hlsProxyLoader';

describe('proxy loader', () => {
  const proxied = 'http://127.0.0.1:9/proxy/token?url=https%3A%2F%2Fx.apple.com%2Fa.m3u8';

  it('finds the prefix, or none on a URL that was not proxied', () => {
    expect(hlsProxyPrefix(proxied)).toBe('http://127.0.0.1:9/proxy/token?url=');
    expect(hlsProxyPrefix('https://x.apple.com/a.m3u8')).toBeNull();
  });

  it('sends remote URLs through and leaves local ones alone', () => {
    const prefix = hlsProxyPrefix(proxied);
    expect(throughProxy('https://x.apple.com/s.m4s', prefix)).toBe(`${prefix}${encodeURIComponent('https://x.apple.com/s.m4s')}`);
    expect(throughProxy(proxied, prefix)).toBe(proxied);
    expect(throughProxy('blob:abc', prefix)).toBe('blob:abc');
    expect(throughProxy('https://x/s', null)).toBe('https://x/s');
  });
});

describe('relative segments', () => {
  it("reports answers from the upstream address, so a playlist's relative files resolve against it", () => {
    const proxied = 'http://127.0.0.1:9/proxy/token?url=https%3A%2F%2Fx.apple.com%2Fdir%2Fv.m3u8';
    const prefix = hlsProxyPrefix(proxied);
    expect(upstreamOf(proxied, prefix)).toBe('https://x.apple.com/dir/v.m3u8');
    expect(upstreamOf('https://x.apple.com/a', prefix)).toBe('https://x.apple.com/a');

    const Loader = hlsProxyLoader(proxied) as new (config: unknown) => { load: (c: { url?: string }, config: unknown, cb: unknown) => void };
    const seen: string[] = [];
    new Loader({}).load({ url: proxied }, {}, { onSuccess: (response: { url: string }) => seen.push(response.url) });
    loaded.calls[loaded.calls.length - 1]!.answer(proxied);
    expect(seen).toEqual(['https://x.apple.com/dir/v.m3u8']);
    // The resolved segment is absolute again, so it goes through the proxy with its own address.
    new Loader({}).load({ url: 'https://x.apple.com/dir/seg.mp4' }, {}, { onSuccess: () => {} });
    expect(loaded.calls[loaded.calls.length - 1]!.url).toBe(`${prefix}${encodeURIComponent('https://x.apple.com/dir/seg.mp4')}`);
  });
});

// Tauri applies this CSP to packaged builds only, so a dev run can't show a loop being blocked.
describe('release CSP', () => {
  it('lets the loop play through the local proxy with hls.js', async () => {
    const raw = (await import('../../src-tauri/tauri.conf.json?raw')).default;
    const csp: string = JSON.parse(raw).app.security.csp;
    const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';
    expect(directive('media-src')).toContain('blob:');
    expect(directive('media-src')).toContain('http://127.0.0.1:*');
    expect(directive('connect-src')).toContain('http://127.0.0.1:*');
    expect(directive('worker-src')).toContain('blob:');
  });
});
