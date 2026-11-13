import { proxyImageUrl } from "./api/images";
import { proxiedImage } from "./imageProxy";
import { useImageProxyStore } from "../store/useImageProxyStore";

/** Shared by the images Flow draws and exports: the Recap poster and the lyric card. */

const LOAD_TIMEOUT_MS = 5_000;
const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i;

/** An image the canvas may read back, through the local proxy that allows it; null if it won't load. */
export async function loadCanvasImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    // Artwork the app already serves locally loads as it is; the backend refuses to proxy it again.
    const local = LOOPBACK.test(url);
    const routed = local ? url : proxiedImage(url, useImageProxyStore.getState().base);
    const src = local || routed !== url ? routed : await proxyImageUrl(url);
    return await new Promise((resolve) => {
      const image = new Image();
      const timeout = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
      image.crossOrigin = "anonymous";
      image.onload = () => {
        clearTimeout(timeout);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
      image.src = src;
    });
  } catch {
    return null;
  }
}

/** Shortens `text` with an ellipsis until it fits. */
export function fitText(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
