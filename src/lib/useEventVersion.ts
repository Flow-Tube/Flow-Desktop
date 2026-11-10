import { useEffect, useState } from "react";

/** Counts how often `event` fired on the window, so an effect that depends on it runs again. */
export function useEventVersion(event: string, enabled = true): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setVersion((current) => current + 1);
    window.addEventListener(event, bump);
    return () => window.removeEventListener(event, bump);
  }, [enabled, event]);
  return version;
}
