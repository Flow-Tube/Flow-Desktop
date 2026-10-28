import { useEffect } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { setFullscreenPanelHost } from "../../lib/fullscreenPanelHost";

export const FULLSCREEN_PANEL_WIDTH_PX = 400;

/*
  The right side of the fullscreen frame. Opening a panel widens it and the video
  narrows to make room, the same push the side rail does, so the whole picture stays
  in view and the control bar shrinks with it.
*/
export function FullscreenPanelHost() {
  const open = usePlayerStore((s) => s.fullscreenPanel !== null);
  const setFullscreenPanel = usePlayerStore((s) => s.setFullscreenPanel);

  // Bubbles after the player menus claim Escape and before the player leaves fullscreen.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setFullscreenPanel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setFullscreenPanel]);

  return (
    <aside
      inert={!open}
      style={{ width: open ? FULLSCREEN_PANEL_WIDTH_PX : 0 }}
      className={`h-full shrink-0 overflow-hidden bg-background transition-[width] duration-[var(--motion-panel)] ease-[var(--motion-ease)] ${
        open ? "border-l border-chrome-neutral-800" : ""
      }`}
    >
      <div ref={setFullscreenPanelHost} style={{ width: FULLSCREEN_PANEL_WIDTH_PX }} className="h-full p-3" />
    </aside>
  );
}
