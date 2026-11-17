import { useEffect, useState } from "react";

import { proxyImageUrl } from "./api/images";
import { proxiedImage } from "./imageProxy";
import { useImageProxyStore } from "../store/useImageProxyStore";

/**
 * How long a proxied address is handed out again. The backend serves it for six hours, and
 * one kept past that came back as a broken image for the rest of the session.
 */
export const PROXIED_URL_LIFETIME_MS = 5 * 60 * 60 * 1000;

const proxyCache = new Map<string, { url: string; at: number }>();
const pending = new Map<string, Promise<string>>();

/** The proxied address held for `src`, unless it is old enough to have stopped working. */
export function heldProxiedUrl(src: string, now = Date.now()): string | undefined {
  const held = proxyCache.get(src);
  if (!held) return undefined;
  if (now - held.at < PROXIED_URL_LIFETIME_MS) return held.url;
  proxyCache.delete(src);
  return undefined;
}

export function holdProxiedUrl(src: string, url: string, now = Date.now()): void {
  proxyCache.set(src, { url, at: now });
}

function isLoopbackUrl(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url);
}

export function useProxiedImageUrl(src: string | null | undefined): string | undefined {
  const proxyBase = useImageProxyStore((state) => state.base);
  const trimmed = src?.trim();
  // Where the image route exists, hosts it serves need no per-image IPC call.
  const routed = trimmed ? proxiedImage(trimmed, proxyBase) : trimmed;
  const normalized = routed === trimmed ? trimmed : undefined;
  const [proxied, setProxied] = useState<string | undefined>(() => {
    if (!normalized) return undefined;
    if (isLoopbackUrl(normalized)) return normalized;
    return heldProxiedUrl(normalized);
  });

  useEffect(() => {
    if (!normalized) {
      setProxied(undefined);
      return;
    }
    if (isLoopbackUrl(normalized)) {
      setProxied(normalized);
      return;
    }

    const cached = heldProxiedUrl(normalized);
    if (cached) {
      setProxied(cached);
      return;
    }

    let active = true;
    const request = pending.get(normalized) ?? proxyImageUrl(normalized);
    pending.set(normalized, request);
    request
      .then((url) => {
        holdProxiedUrl(normalized, url);
        if (active) setProxied(url);
      })
      .catch(() => {
        if (active) setProxied(normalized);
      })
      .finally(() => {
        if (pending.get(normalized) === request) {
          pending.delete(normalized);
        }
      });

    return () => {
      active = false;
    };
  }, [normalized]);

  return routed !== trimmed ? routed : (proxied ?? normalized);
}
