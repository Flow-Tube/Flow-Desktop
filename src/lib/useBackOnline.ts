import { useEffect, useRef } from "react";

/**
 * Runs `onBack` each time the connection comes back while `enabled`, never on mount.
 * The `online` event fires once per offline to online change, so a screen that fails
 * again waits for the next reconnect or for its Retry button instead of looping.
 */
export function useBackOnline(onBack: () => void, enabled: boolean) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    const handler = () => latest.current();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [enabled]);
}
