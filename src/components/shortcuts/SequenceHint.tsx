import { useEffect, useState } from "react";

import { getString } from "../../lib/i18n/index";
import { SEQUENCE_MS } from "../../lib/shortcuts/command";
import { SHORTCUT_SEQUENCE_EVENT } from "../../lib/shortcuts/useAppShortcuts";

/** "G, then…" while Flow waits for the second key of a go-to shortcut. */
export function SequenceHint() {
  const [first, setFirst] = useState<string | null>(null);

  useEffect(() => {
    const onSequence = (event: Event) => setFirst((event as CustomEvent<string | null>).detail);
    window.addEventListener(SHORTCUT_SEQUENCE_EVENT, onSequence);
    return () => window.removeEventListener(SHORTCUT_SEQUENCE_EVENT, onSequence);
  }, []);

  useEffect(() => {
    if (!first) return;
    const timer = window.setTimeout(() => setFirst(null), SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, [first]);

  if (!first) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-chrome-neutral-800 bg-surface-container px-4 py-2 text-sm font-medium text-chrome-neutral-100 animate-fade-in"
    >
      {getString("keyboard_sequence_waiting", first)}
    </div>
  );
}
