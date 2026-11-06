import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { keyBelongsToTarget } from "../../lib/musicPlayerKeys";
import { KeyMapList } from "./KeyMapList";

/** `?` opens the key list from anywhere, unless the key is being typed into something. */
export function KeyboardHelpHost() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (open && event.key === "Escape") {
        // Taken on the way down, so fullscreen or the full player behind it stays as it is.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (keyBelongsToTarget(event.target, event.key)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-chrome-black/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-help-title"
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container"
          >
            <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-6 py-4">
              <h2 id="keyboard-help-title" className="text-lg font-bold tracking-tight text-chrome-neutral-100">
                {getString("keyboard_shortcuts_title")}
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label={getString("close")}
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <KeyMapList />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
