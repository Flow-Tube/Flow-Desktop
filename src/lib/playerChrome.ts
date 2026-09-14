/**
 * Visibility policy for the player chrome — the control bar and the mouse
 * cursor drawn over the video.
 *
 * Two rules keep this out of the player's hot path:
 *
 * 1. The reveal callback has to keep a stable identity. It is a dependency of
 *    the player's global keyboard effect and it is handed down to the control
 *    bar, so a callback rebuilt every time playback state flips re-subscribes
 *    that listener and defeats memoisation on every child holding it. The
 *    conditions below are therefore read from a ref at call time instead of
 *    being captured in the callback, and they live here so that the condition
 *    list stays readable and testable on its own.
 * 2. Whether the chrome may hide is a question about playback, not about where
 *    the pointer is. A reveal triggered from the keyboard must arm the hide
 *    timer too, or a control bar summoned by a key press stays up forever.
 *    Pointer position only decides whether the cursor is hidden alongside the
 *    controls — hiding a cursor that is somewhere else on screen would be
 *    invisible at best and confusing at worst.
 */

export const PLAYER_CHROME_HIDE_DELAY_MS = 2400;

export type PlayerChromeConditions = {
  isPlaying: boolean;
  settingsOpen: boolean;
  isScrubbing: boolean;
  isPipMode: boolean;
  isLoading: boolean;
  hasError: boolean;
};

/** Whether the chrome is allowed to hide itself after the idle delay. */
export function canAutoHidePlayerChrome({
  isPlaying,
  settingsOpen,
  isScrubbing,
  isPipMode,
  isLoading,
  hasError,
}: PlayerChromeConditions): boolean {
  return isPlaying && !settingsOpen && !isScrubbing && !isPipMode && !isLoading && !hasError;
}

/**
 * Whether focus landing on `candidate` should hold the chrome open. Keyboard
 * focus resting on a control does, so a keyboard user never loses sight of the
 * element they are on; the player root itself does not, because it carries a
 * tabindex only so the video area can take key events.
 *
 * Focus that merely followed a click does not count either. Clicking play also
 * focuses the button, and pinning on that would leave the control bar up for
 * the rest of the video — `:focus-visible` is exactly that distinction.
 */
export function shouldPinPlayerChrome(root: Node, candidate: EventTarget | null): boolean {
  if (!(candidate instanceof Element)) return false;
  if (candidate === root || !root.contains(candidate)) return false;
  return candidate.matches(":focus-visible");
}
