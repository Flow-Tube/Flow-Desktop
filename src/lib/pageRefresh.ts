import { useEffect, useRef } from "react";

let current: { refresh: () => void } | null = null;

/** Lets Mod+R and F5 refresh this page's content while it is the one on screen. */
export function usePageRefresh(refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const entry = { refresh: () => latest.current() };
    current = entry;
    return () => {
      if (current === entry) current = null;
    };
  }, []);
}

/** False when the page on screen has nothing to refresh. */
export function refreshPage(): boolean {
  if (!current) return false;
  current.refresh();
  return true;
}
