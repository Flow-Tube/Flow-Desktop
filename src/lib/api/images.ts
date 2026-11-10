import { invokeBackend } from "./errors";

export function proxyImageUrl(url: string): Promise<string> {
  return invokeBackend<string>("proxy_image_url", { url });
}

/** A local URL for a motion artwork playlist, which the webview may only reach through the proxy. */
export function proxyArtworkLoop(url: string): Promise<string> {
  return invokeBackend<string>("proxy_artwork_loop", { url });
}
