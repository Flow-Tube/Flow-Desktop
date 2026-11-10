import Hls from "hls.js";

/** The part of a proxied playlist's URL that any other URL can be appended to. */
export function hlsProxyPrefix(proxiedUrl: string): string | null {
  const marker = "?url=";
  const index = proxiedUrl.indexOf(marker);
  return index < 0 ? null : proxiedUrl.slice(0, index + marker.length);
}

export function throughProxy(url: string, prefix: string | null): string {
  return prefix && !url.startsWith("http://127.0.0.1:") && !url.startsWith("blob:")
    ? `${prefix}${encodeURIComponent(url)}`
    : url;
}

/** The address a proxied URL stands for, or the URL itself when it was not proxied. */
export function upstreamOf(url: string, prefix: string | null): string {
  return prefix && url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : url;
}

interface HlsLoader {
  load(context: { url?: string }, config: unknown, callbacks: HlsCallbacks): void;
}

interface HlsCallbacks {
  onSuccess: (response: { url?: string }, ...rest: unknown[]) => void;
  [name: string]: unknown;
}

/**
 * An hls.js loader that sends every playlist and segment through the proxy the first playlist came
 * from. hls.js resolves a playlist's relative files against the address it answered from, so each
 * answer is reported as coming from the upstream address: Apple's loops name their segments
 * relatively, and resolved against the proxy they would lose their session and fail.
 */
export function hlsProxyLoader(proxiedUrl: string): unknown {
  const prefix = hlsProxyPrefix(proxiedUrl);
  const DefaultLoader = Hls.DefaultConfig.loader as unknown as new (config: unknown) => HlsLoader;
  return class ProxyLoader extends DefaultLoader {
    override load(context: { url?: string }, config: unknown, callbacks: HlsCallbacks) {
      if (context.url) context.url = throughProxy(context.url, prefix);
      const onSuccess = callbacks.onSuccess;
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, ...rest) => onSuccess({ ...response, url: upstreamOf(response.url ?? context.url ?? "", prefix) }, ...rest),
      });
    }
  };
}
