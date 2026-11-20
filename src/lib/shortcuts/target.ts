/** Typing in a field, or a focused control that owns the key itself, keeps the key. */
export function keyBelongsToTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // A slider uses the arrows itself; a button uses Space.
  if (target.getAttribute("role") === "slider" && key.startsWith("Arrow")) return true;
  if ((tag === "BUTTON" || target.getAttribute("role") === "button") && (key === " " || key === "Enter")) {
    return focusedFromKeyboard(target);
  }
  return false;
}

/**
 * A button clicked with the mouse keeps focus in Chromium, and Space would press it again, so
 * Space there still plays or pauses as before. A button reached with Tab keeps its own keys.
 */
function focusedFromKeyboard(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}
