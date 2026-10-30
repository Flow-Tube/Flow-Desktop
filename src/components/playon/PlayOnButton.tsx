import { useEffect, useRef, useState } from "react";
import { MonitorSpeaker } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { usePlayOnAvailable, useRemoteActive } from "../../lib/live/usePlayOn";
import { PlayOnPopover } from "./PlayOnPopover";

/** The devices button of a player bar; hidden while no other device can be reached. */
export function PlayOnButton({ className, iconSize = 18 }: { className: string; iconSize?: number }) {
  const available = usePlayOnAvailable();
  const remote = useRemoteActive();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!available) return null;
  return (
    <div ref={box} className="relative" data-sheet-drag-ignore>
      <button
        type="button"
        aria-label={getString("play_on_title")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${className} ${open || remote ? "text-[var(--color-primary)]" : ""}`}
      >
        <MonitorSpeaker style={{ width: iconSize, height: iconSize }} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-3">
          <PlayOnPopover />
        </div>
      )}
    </div>
  );
}
