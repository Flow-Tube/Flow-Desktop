import { useEffect, type ComponentType } from "react";
import { motion, type Transition } from "framer-motion";
import type { ConfirmItem } from "../../store/useConfirmStore";
import { Button } from "./Button";

const SURFACE_SPRING: Transition = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 };

export interface ConfirmDialogProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  message: string;
  /** The thing the question is about, shown as a card under the message. */
  item?: ConfirmItem;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A yes/no question: Android's `FlowAlertDialog` slots (icon, title, text, Cancel before Confirm). */
export function ConfirmDialog({
  icon: Icon,
  title,
  message,
  item,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <motion.div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-chrome-black/70 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onCancel}
      role="presentation"
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={SURFACE_SPRING}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container"
      >
        <div className="flex items-start gap-4 p-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-container-high">
            <Icon className={`h-6 w-6 ${destructive ? "text-chrome-red-400" : "text-chrome-neutral-200"}`} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="confirm-dialog-title" className="text-lg font-bold tracking-tight text-chrome-neutral-100">
              {title}
            </h2>
            <p id="confirm-dialog-message" className="mt-1 whitespace-pre-line text-sm leading-relaxed text-chrome-neutral-400">
              {message}
            </p>
            {item && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-chrome-neutral-800 bg-surface-container-low p-2.5">
                {item.image && (
                  <img
                    src={item.image}
                    alt=""
                    className="aspect-video w-24 shrink-0 rounded-lg bg-surface-container-high object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-chrome-neutral-100">{item.title}</p>
                  {item.subtitle && <p className="truncate text-xs text-chrome-neutral-500">{item.subtitle}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-chrome-neutral-800 bg-surface-container-low px-6 py-3">
          {/* Enter on a destructive question lands on Cancel, so a stray key press can't delete anything. */}
          <Button variant="ghost" onClick={onCancel} autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm} autoFocus={!destructive}>
            {confirmLabel}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
