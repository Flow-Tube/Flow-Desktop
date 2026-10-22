import { useEffect, useRef, useState } from "react";
import { getString } from "../../lib/i18n/index";

/** How often a stream that should have started is checked again. */
const RECHECK_MS = 30_000;

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

interface UpcomingCountdownProps {
  /** Epoch milliseconds the premiere or stream starts. */
  startsAtMs: number;
  /** Called when the start time arrives, then every 30 seconds after it. */
  onDue?: () => void;
}

/** The time left before an upcoming premiere, which asks to be retried once it is due. */
export function UpcomingCountdown({ startsAtMs, onDue }: UpcomingCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;
  const remaining = startsAtMs - now;
  const due = remaining <= 0;

  useEffect(() => {
    if (due) {
      const timer = window.setTimeout(() => {
        setNow(Date.now());
        onDueRef.current?.();
      }, RECHECK_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      const next = Date.now();
      setNow(next);
      if (next >= startsAtMs) onDueRef.current?.();
    }, Math.min(1000, remaining));
    return () => window.clearTimeout(timer);
  }, [due, now, remaining, startsAtMs]);

  return (
    <p className="mt-3 text-sm font-semibold tabular-nums text-chrome-neutral-200">
      {due
        ? getString("player_error_upcoming_starting")
        : getString("player_error_upcoming_starts_in", formatRemaining(remaining))}
    </p>
  );
}
