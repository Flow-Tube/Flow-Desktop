export type ShortsKeyAction =
  | { type: "page"; offset: 1 | -1 }
  | { type: "mute" }
  | { type: "toggle" }
  | { type: "seek"; direction: 1 | -1 }
  | { type: "jump"; tenths: number };

/** Up and Down page between Shorts, as on the web, so the volume stays with the wheel and the slider. */
export function shortsKeyAction(event: Pick<KeyboardEvent, "key" | "shiftKey">): ShortsKeyAction | null {
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    if (key === "n") return { type: "page", offset: 1 };
    if (key === "p") return { type: "page", offset: -1 };
    return null;
  }
  switch (key) {
    case "arrowup":
      return { type: "page", offset: -1 };
    case "arrowdown":
      return { type: "page", offset: 1 };
    case "m":
      return { type: "mute" };
    case " ":
    case "k":
      return { type: "toggle" };
    case "arrowleft":
    case "j":
      return { type: "seek", direction: -1 };
    case "arrowright":
    case "l":
      return { type: "seek", direction: 1 };
    default:
      return /^[0-9]$/.test(key) ? { type: "jump", tenths: Number(key) } : null;
  }
}

/**
 * Listens ahead of the video player's own keys, which would otherwise also reach a mini player
 * still running behind the Shorts page. Typing in a field and keys held with Ctrl, Alt or Meta stay
 * with whatever has them, and a dialog on top of the page keeps them all. Focus may still be outside
 * a dialog, so the check isn't on the key's target.
 */
export function listenForShortsKeys(handle: (action: ShortsKeyAction, event: KeyboardEvent) => boolean): () => void {
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])')) return;
    const action = shortsKeyAction(event);
    if (!action || !handle(action, event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  return () => window.removeEventListener("keydown", onKey, { capture: true });
}
