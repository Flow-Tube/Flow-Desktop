import * as dashjs from "dashjs";
import { IS_LINUX_RUNTIME } from "./platform";

/** The local proxy's prefix in a proxied manifest URL, which every segment request goes through too. */
export function dashProxyPrefix(dashUrl: string): string | null {
  const marker = "?url=";
  const index = dashUrl.indexOf(marker);
  return index < 0 ? null : dashUrl.slice(0, index + marker.length);
}

type DashSettings = Parameters<dashjs.MediaPlayerClass["updateSettings"]>[0];
type DashBufferSettings = NonNullable<NonNullable<DashSettings["streaming"]>["buffer"]>;

/**
 * Buffer settings every dash.js player here needs on WebKitGTK. After a seek or a fast quality
 * switch dash.js prunes what lies beyond its buffer target, and that is often the tail of the
 * range being played. dash.js documents the result: "Pruning it causes a flush and reenqueue in
 * WPE and WebKitGTK based browsers. This stresses the video decoder and can cause stuttering".
 */
export function webkitGtkBufferSettings(isLinux: boolean = IS_LINUX_RUNTIME): DashBufferSettings {
  return isLinux ? { avoidCurrentTimeRangePruning: true } : {};
}

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
      buffer: { ...webkitGtkBufferSettings(), ...streaming.buffer },
    },
  });
  return player;
}
