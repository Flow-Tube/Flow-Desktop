import { useSyncExternalStore } from "react";

const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void): () => void {
  const query = media();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Whether the system is in dark mode right now. */
export function useSystemDarkMode(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false);
}
