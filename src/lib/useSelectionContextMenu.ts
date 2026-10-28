import { useCallback, useEffect, useState } from "react";
import { selectedText, selectionTouches } from "./textSelection";

export interface SelectionMenuState {
  anchor: { top: number; left: number };
  text: string;
}

type RightClick = Pick<MouseEvent, "defaultPrevented" | "target" | "clientX" | "clientY">;

/** The menu a right-click should open, or null when it lands away from highlighted text. */
export function selectionMenuFor(event: RightClick, selection: Selection | null): SelectionMenuState | null {
  if (event.defaultPrevented) return null;
  const text = selectedText(selection);
  if (!text || !selectionTouches(event.target as Node | null, selection)) return null;
  return { anchor: { top: event.clientY, left: event.clientX }, text };
}

/**
 * Opens Flow's own menu on a right-click over highlighted text. Card and player
 * menus claim the event first with preventDefault, and this listener sits on the
 * document, so it only sees right-clicks nothing else has taken.
 */
export function useSelectionContextMenu() {
  const [menu, setMenu] = useState<SelectionMenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const next = selectionMenuFor(event, window.getSelection());
      if (!next) return;
      event.preventDefault();
      setMenu(next);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, close };
}
