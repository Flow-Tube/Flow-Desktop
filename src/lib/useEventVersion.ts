import { useEffect, useState } from "react";

/** Counts how often `event` fired on the window, so an effect that depends on it runs again. */
export function useEventVersion(event: string): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((current) => current + 1);
    window.addEventListener(event, bump);
    return () => window.removeEventListener(event, bump);
  }, [event]);
  return version;
}
