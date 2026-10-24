import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { Rgb } from "../../../lib/useDominantColor";
import { getString } from "../../../lib/i18n/index";

const rgba = (c: Rgb, a: number): string => `rgba(${c.r},${c.g},${c.b},${a})`;

/** Reads each new line to a screen reader as it becomes current, without interrupting. */
export function CurrentLineAnnouncer({ text }: { text: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

/** Shown while the user has scrolled away from the sung line; brings the list back to it. */
export function LyricsResyncButton({ visible, accent, onClick }: { visible: boolean; accent: Rgb; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={getString("music_resync")}
      tabIndex={visible ? 0 : -1}
      className={`absolute bottom-6 left-1/2 z-20 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full bg-chrome-black/40 transition-[opacity,background-color] duration-150 ease-out hover:bg-chrome-black/60 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ color: rgba(accent, 1) }}
    >
      <RefreshCw className="h-5 w-5" />
    </button>
  );
}

/** Names the lyrics source for three seconds after it changes, then fades out. */
export function LyricsProviderLabel({ providerName, accent }: { providerName: string; accent: Rgb }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 3000);
    return () => window.clearTimeout(timer);
  }, [providerName]);
  if (!providerName.trim()) return null;
  return (
    <span
      className={`pointer-events-none absolute left-1/2 top-[38px] z-10 -translate-x-1/2 text-[11px] font-medium tracking-wide transition-opacity duration-[600ms] ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      style={{ color: rgba(accent, 0.6) }}
    >
      {providerName}
    </span>
  );
}
