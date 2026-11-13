import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { getString } from "../../../lib/i18n/index";

/** A dialog over the player; Escape closes it without also closing the player behind it. */
export function LyricsDialog({
  title,
  titleId,
  onClose,
  children,
  footer,
  customHeader,
  maxWidth = "max-w-lg",
  contentClassName = "min-h-0 flex-1 overflow-y-auto px-4 py-4",
}: {
  title?: string;
  titleId?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  customHeader?: ReactNode;
  maxWidth?: string;
  contentClassName?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-chrome-black/75 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-fade-in flex max-h-[min(720px,calc(100vh-3rem))] w-full ${maxWidth} flex-col rounded-3xl border border-chrome-neutral-800 bg-surface-container shadow-2xl`}
      >
        {customHeader ? (
          customHeader
        ) : (
          <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-6 py-4">
            <h2 id={titleId} className="text-base font-semibold text-chrome-neutral-100">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={getString("close")}
              className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className={contentClassName}>{children}</div>
        {footer && <div className="border-t border-chrome-neutral-800 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
