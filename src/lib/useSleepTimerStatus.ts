import { useEffect, useState } from "react";

import { useSleepTimerStore, type SleepTimerMode } from "../store/useSleepTimerStore";
import { getString } from "./i18n/index";
import { formatRemaining } from "./sleepTimer";

export interface SleepTimerStatus {
  mode: SleepTimerMode;
  /** A short label: Off, the time left, or End of song. */
  label: string;
  /** A sentence for the panel's header, or null while no timer is set. */
  detail: string | null;
}

/** The timer's state for display, ticking once a second while a countdown runs. */
export function useSleepTimerStatus(): SleepTimerStatus {
  const mode = useSleepTimerStore((s) => s.mode);
  const endsAt = useSleepTimerStore((s) => s.endsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== "timer") return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [mode]);

  if (mode === "timer" && endsAt !== null) {
    const left = formatRemaining(endsAt - now);
    return { mode, label: left, detail: getString("sleep_timer_stops_in", left) };
  }
  if (mode === "endOfSong") {
    return { mode, label: getString("sleep_timer_end_of_song"), detail: getString("sleep_timer_stops_at_end") };
  }
  return { mode, label: getString("sleep_timer_off"), detail: null };
}
