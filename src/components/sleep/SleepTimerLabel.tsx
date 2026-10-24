import { useSleepTimerStatus } from "../../lib/useSleepTimerStatus";

/**
 * The timer's short state (Off, the time left, End of song). Its own component
 * so the once-a-second countdown re-renders only this text, not the player.
 */
export function SleepTimerLabel() {
  return <>{useSleepTimerStatus().label}</>;
}
