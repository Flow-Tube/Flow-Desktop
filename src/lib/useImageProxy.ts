import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { proxiedImage } from "./imageProxy";
import { useImageProxyStore } from "../store/useImageProxyStore";

/** Loads the image proxy base once at startup; without one, images load directly. */
export function useImageProxyBootstrap(): void {
  const setBase = useImageProxyStore((state) => state.setBase);
  useEffect(() => {
    invoke<string | null>("image_proxy_base")
      .then((base) => setBase(base ?? null))
      .catch(() => {});
  }, [setBase]);
}

/** Maps an image URL to the one the webview should load: through the image proxy where one is needed. */
export function useProxyImageSrc(): (url: string) => string {
  const base = useImageProxyStore((state) => state.base);
  return useCallback((url: string) => proxiedImage(url, base), [base]);
}
