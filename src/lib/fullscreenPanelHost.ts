import { useSyncExternalStore } from "react";

/*
  The element inside the fullscreen player frame that side panels render into. The
  frame lives outside the routes, and the watch page that owns the panels' data
  portals into it, so the two meet here instead of through props.
*/

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setFullscreenPanelHost(element: HTMLElement | null) {
  if (host === element) return;
  host = element;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFullscreenPanelHost(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => host, () => null);
}
