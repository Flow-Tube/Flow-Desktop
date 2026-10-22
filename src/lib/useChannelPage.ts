import { useCallback, useEffect, useRef, useState } from 'react';
import { getChannelAbout, getChannelPage } from './api/youtube';
import type { ChannelAbout, ChannelPage } from '../types/video';

/** A channel's header, tabs and Home, from one request; `retry` asks again after a failure. */
export function useChannelPage(channelId: string | undefined) {
  const [page, setPage] = useState<ChannelPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!channelId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    setPage(null);
    getChannelPage(channelId)
      .then((next) => {
        if (request === requestRef.current) setPage(next);
      })
      .catch((err) => {
        if (request !== requestRef.current) return;
        console.warn('Failed to load the channel', err);
        setFailed(true);
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, [channelId, nonce]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);
  return { page, loading, failed, retry };
}

const aboutCache = new Map<string, ChannelAbout>();

/** The About panel, fetched the first time it is opened. */
export function useChannelAbout(token: string | null | undefined, open: boolean) {
  const [about, setAbout] = useState<ChannelAbout | null>(() => (token ? aboutCache.get(token) ?? null : null));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    const cached = aboutCache.get(token);
    if (cached) {
      setAbout(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getChannelAbout(token)
      .then((next) => {
        aboutCache.set(token, next);
        if (!cancelled) setAbout(next);
      })
      .catch((err) => {
        console.warn('Failed to load the About panel', err);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, open]);

  return { about, loading, failed };
}
