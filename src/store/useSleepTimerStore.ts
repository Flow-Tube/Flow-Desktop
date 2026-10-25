import { create } from "zustand";

import { SETTINGS } from "../lib/settings/schema";
import { getSettingValue, setSettingValue } from "./useAppSettingsStore";

export type SleepTimerMode = "off" | "timer" | "endOfSong";

interface SleepTimerState {
  mode: SleepTimerMode;
  /** When a countdown stops playback, in epoch milliseconds; null otherwise. */
  endsAt: number | null;
  /** Whether this timer quits Flow instead of pausing. */
  quitOnExpiry: boolean;

  start: (minutes: number, quit: boolean) => void;
  startEndOfSong: (quit: boolean) => void;
  /** Changes what a running timer does when it ends. */
  setQuitOnExpiry: (quit: boolean) => void;
  cancel: () => void;
}

/** The remembered "Quit Flow when it ends" choice, which new timers start from. */
export const prefersQuitOnExpiry = (): boolean =>
  getSettingValue(SETTINGS.SLEEP_TIMER_CLOSE_APP_ON_EXPIRY) === "true";

export const setPrefersQuitOnExpiry = (quit: boolean): Promise<boolean> =>
  setSettingValue(SETTINGS.SLEEP_TIMER_CLOSE_APP_ON_EXPIRY, String(quit));

/** One sleep timer for the music and video players alike; `useSleepTimerDriver` runs it. */
export const useSleepTimerStore = create<SleepTimerState>((set) => ({
  mode: "off",
  endsAt: null,
  quitOnExpiry: false,

  start: (minutes, quit) => {
    if (!(minutes > 0)) return;
    set({ mode: "timer", endsAt: Date.now() + minutes * 60_000, quitOnExpiry: quit });
  },

  startEndOfSong: (quit) => set({ mode: "endOfSong", endsAt: null, quitOnExpiry: quit }),

  setQuitOnExpiry: (quit) => set((s) => (s.mode === "off" ? {} : { quitOnExpiry: quit })),

  cancel: () => set({ mode: "off", endsAt: null, quitOnExpiry: false }),
}));
