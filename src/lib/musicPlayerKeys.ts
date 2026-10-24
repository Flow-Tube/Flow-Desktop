/**
 * The full player's keyboard map. Flow Android's `MediaKeyboardShortcuts` was
 * written from this set ("the keys Flow Desktop and YouTube use"), so both apps
 * answer the same keys.
 */
export type MusicPlayerKeyAction =
  | { kind: "toggle-play" }
  | { kind: "seek-by"; seconds: number }
  | { kind: "seek-to-fraction"; fraction: number }
  | { kind: "volume-by"; delta: number }
  | { kind: "toggle-mute" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "toggle-shuffle" }
  | { kind: "cycle-repeat" }
  | { kind: "toggle-queue" };

export const VOLUME_STEP = 0.05;

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function musicPlayerKeyAction(event: KeyLike, seekSeconds: number): MusicPlayerKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey) {
    if (key === "n") return { kind: "next" };
    if (key === "p") return { kind: "previous" };
    return null;
  }
  switch (key) {
    case " ":
    case "k":
      return { kind: "toggle-play" };
    case "j":
    case "ArrowLeft":
      return { kind: "seek-by", seconds: -seekSeconds };
    case "l":
    case "ArrowRight":
      return { kind: "seek-by", seconds: seekSeconds };
    case "ArrowUp":
      return { kind: "volume-by", delta: VOLUME_STEP };
    case "ArrowDown":
      return { kind: "volume-by", delta: -VOLUME_STEP };
    case "m":
      return { kind: "toggle-mute" };
    case "s":
      return { kind: "toggle-shuffle" };
    case "r":
      return { kind: "cycle-repeat" };
    case "q":
      return { kind: "toggle-queue" };
    default:
      if (/^[0-9]$/.test(key)) return { kind: "seek-to-fraction", fraction: Number(key) / 10 };
      return null;
  }
}

/** Typing in a field, or a focused control that owns the key itself, keeps the key. */
export function keyBelongsToTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // A slider uses the arrows itself; a button uses Space.
  if (target.getAttribute("role") === "slider" && key.startsWith("Arrow")) return true;
  if ((tag === "BUTTON" || target.getAttribute("role") === "button") && (key === " " || key === "Enter")) return true;
  return false;
}

/** The volume after one wheel notch over a volume control: up is louder. */
export function volumeAfterWheel(volume: number, deltaY: number): number {
  if (deltaY === 0) return volume;
  const next = volume + (deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
  return Math.round(Math.min(1, Math.max(0, next)) * 100) / 100;
}
