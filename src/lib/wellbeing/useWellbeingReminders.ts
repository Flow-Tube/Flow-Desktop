import { useEffect } from "react";

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { showDownloadNotification } from "../api/downloads";
import { getString, type StringKey } from "../i18n/index";
import { SETTINGS } from "../settings/schema";
import { bedtimeState, nextBedtimeAt } from "./bedtime";
import { BreakClock } from "./breakClock";

const TICK_MS = 15_000;
/** A longer gap between ticks means the computer slept: that time wasn't spent in Flow. */
const SLEEP_GAP_MS = 60_000;

function notify(title: StringKey, body: StringKey) {
  void showDownloadNotification(getString(title), getString(body)).catch((error) => {
    console.warn("Failed to post a reminder", error);
  });
}

/**
 * A computer stays on screen while its owner works elsewhere, so Flow counts as in use while its
 * window has focus, or is visible and playing.
 */
export function flowInUse(): boolean {
  if (document.hidden) return false;
  return document.hasFocus() || usePlayerStore.getState().isPlaying || useMusicPlayerStore.getState().isPlaying;
}

/** The break and bedtime reminders. They run only while Flow does; nothing wakes the computer. */
export function useWellbeingReminders() {
  const breakOn = useAppSettingsStore((s) => s.values[SETTINGS.BREAK_REMINDER] === "true");
  const breakMinutes = Number(useAppSettingsStore((s) => s.values[SETTINGS.BREAK_FREQUENCY]) ?? "30");
  const bedtimeOn = useAppSettingsStore((s) => s.values[SETTINGS.BEDTIME_REMINDER] === "true");
  const bedtimeStart = useAppSettingsStore((s) => s.values[SETTINGS.BEDTIME_START]) ?? "23:00";

  useEffect(() => {
    if (!breakOn) return;
    // Turning it on after a long session must not fire at once, so new settings count afresh.
    const clock = new BreakClock();
    let last = Date.now();
    clock.restart(last);
    const frequencyMs = breakMinutes * 60_000;
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - last > SLEEP_GAP_MS) {
        clock.onHidden(last);
      }
      last = now;
      if (flowInUse()) clock.onShown(now);
      else clock.onHidden(now);
      if (clock.remainingMs(frequencyMs, now) > 0) return;
      clock.restart(now);
      notify("reminder_break_title", "reminder_break_body");
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [breakOn, breakMinutes]);

  useEffect(() => {
    if (!bedtimeOn) return;
    let armedAt = nextBedtimeAt(bedtimeStart, Date.now());
    if (armedAt === null) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const state = bedtimeState(armedAt!, now);
      if (state === "wait") return;
      if (state === "notify") notify("reminder_bedtime_title", "reminder_bedtime_body");
      armedAt = nextBedtimeAt(bedtimeStart, now);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [bedtimeOn, bedtimeStart]);
}
