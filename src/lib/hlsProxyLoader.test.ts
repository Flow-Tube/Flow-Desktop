import { describe, expect, it, vi } from 'vitest';

vi.mock('hls.js', () => ({ default: { DefaultConfig: { loader: class {} } } }));

import { hlsProxyPrefix, throughProxy } from './hlsProxyLoader';

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
