import { useEffect } from "react";

/**
 * While an opaque full-window layer covers the routed page, the page is kept
 * mounted (scroll position and state survive) but marked inert and hidden from
 * rendering, so its playing waves, spinners and shimmers stop painting frames
 * nobody can see and keyboard focus can't wander behind the layer.
 */
export function useCoverAppContent(covering: boolean): void {
  useEffect(() => {
    if (!covering) return;
    const content = document.querySelector<HTMLElement>("[data-app-content]");
    if (!content) return;
    content.inert = true;
    content.dataset.covered = "true";
    return () => {
      content.inert = false;
      delete content.dataset.covered;
    };
  }, [covering]);
}
