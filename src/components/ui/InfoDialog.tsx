import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";

export interface InfoDialogProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  wide?: boolean;
  /** Beside the title, such as a progress spinner. */
  titleAccessory?: ReactNode;
  /** Buttons under the content. */
  footer?: ReactNode;
  children: ReactNode;
}

/** A floating panel of things to read, closed with Escape, its X or a click outside. */
export function InfoDialog({ title, closeLabel, onClose, wide = false, titleAccessory, footer, children }: InfoDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Taken on the way down, so the player's shortcuts, fullscreen or the full player behind never see the key.
      event.stopPropagation();
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-chrome-black/70 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-full w-full ${wide ? "max-w-3xl" : "max-w-xl"} flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container`}
      >
        <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-chrome-neutral-100">
            {title}
            {titleAccessory}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-chrome-neutral-800 bg-surface-container-low px-6 py-3">{footer}</div>}
      </div>
    </motion.div>,
    document.body,
  );
}
