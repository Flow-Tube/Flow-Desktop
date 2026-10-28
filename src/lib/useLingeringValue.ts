import { useEffect, useState } from "react";

/** Follows `value` at once, but holds the last non-null one for `ms` after it clears, so closing can animate. */
export function useLingeringValue<T>(value: T | null, ms: number): T | null {
  const [held, setHeld] = useState<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      setHeld(value);
      return;
    }
    const timer = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return value ?? held;
}
