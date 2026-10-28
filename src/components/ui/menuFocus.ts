const MENU_KEYS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];

/** Moves focus between a menu's items with the arrow, Home and End keys; true when it moved. */
export function moveMenuFocus(container: HTMLElement, key: string): boolean {
  if (!MENU_KEYS.includes(key)) return false;
  const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  if (items.length === 0) return false;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = key === "Home"
    ? 0
    : key === "End"
      ? items.length - 1
      : key === "ArrowDown" || key === "ArrowRight"
        ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
  items[next]?.focus();
  return true;
}
