/** The sleep timer's choices and arithmetic, shared by the music and video players (Android's SleepTimerManager). */

export const SLEEP_TIMER_PRESETS = [10, 15, 30, 45, 60, 90] as const;

/** A custom time is whole minutes from one minute to a day, as on Android. */
export const MIN_CUSTOM_MINUTES = 1;
export const MAX_CUSTOM_MINUTES = 1440;

/** Music fades out over this many seconds before the timer stops it. */
export const SLEEP_FADE_SECONDS = 20;

/** Minutes from a custom entry, or null when it is not a whole number in range. */
export function parseCustomMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes >= MIN_CUSTOM_MINUTES && minutes <= MAX_CUSTOM_MINUTES ? minutes : null;
}

/** How loud the music plays with `remainingSeconds` left: full until the fade, then down to silence. */
export function fadeLevel(remainingSeconds: number): number {
  if (remainingSeconds >= SLEEP_FADE_SECONDS) return 1;
  return Math.max(0, remainingSeconds / SLEEP_FADE_SECONDS);
}

/** `h:mm:ss` or `m:ss` for the time left on the timer. */
export function formatRemaining(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
