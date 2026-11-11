import * as dashjs from "dashjs";

/** The local proxy's prefix in a proxied manifest URL, which every segment request goes through too. */
export function dashProxyPrefix(dashUrl: string): string | null {
  const marker = "?url=";
  const index = dashUrl.indexOf(marker);
  return index < 0 ? null : dashUrl.slice(0, index + marker.length);
}

type DashSettings = Parameters<dashjs.MediaPlayerClass["updateSettings"]>[0];

/**
 * A dash.js player whose segment requests go through the same local proxy as its manifest,
 * for the lightweight players (Shorts, card previews). Call `initialize` on it to start.
 */
export function createProxiedDashPlayer(dashUrl: string, streaming: NonNullable<DashSettings["streaming"]> = {}): dashjs.MediaPlayerClass {
  const player = dashjs.MediaPlayer().create();
  const prefix = dashProxyPrefix(dashUrl);
  if (prefix) {
    player.extend(
      "RequestModifier",
      () => ({
        modifyRequestURL: (url: string) =>
          url.startsWith("http://127.0.0.1:") || url.startsWith("blob:") ? url : `${prefix}${encodeURIComponent(url)}`,
        modifyRequestHeader: (xhr: XMLHttpRequest) => xhr,
      }),
      true,
    );
  }
  player.updateSettings({
    streaming: {
      capabilities: { useMediaCapabilitiesApi: false },
      // dash.js otherwise keeps these in localStorage, which every profile shares.
      lastBitrateCachingInfo: { enabled: false },
      lastMediaSettingsCachingInfo: { enabled: false },
      ...streaming,
    },
  });
  return player;
}
