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

/** An hls.js loader that sends every playlist and segment through the proxy the first playlist came from. */
interface HlsLoader {
  load(context: { url?: string }, config: unknown, callbacks: unknown): void;
}

/** An hls.js loader that sends every playlist and segment through the proxy the first playlist came from. */
export function hlsProxyLoader(proxiedUrl: string): unknown {
  const prefix = hlsProxyPrefix(proxiedUrl);
  const DefaultLoader = Hls.DefaultConfig.loader as unknown as new (config: unknown) => HlsLoader;
  return class ProxyLoader extends DefaultLoader {
    override load(context: { url?: string }, config: unknown, callbacks: unknown) {
      if (context.url) context.url = throughProxy(context.url, prefix);
      super.load(context, config, callbacks);
    }
  };
}
