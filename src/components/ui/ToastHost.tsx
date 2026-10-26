import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useUiStore, type ToastVariant } from "../../store/useUiStore";

const toastIcons: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const toastIconStyles: Record<ToastVariant, string> = {
  success: "text-[var(--color-primary)]",
  error: "text-chrome-red-400",
  info: "text-chrome-neutral-300",
};

export function ToastHost() {
  const toast = useUiStore((state) => state.toast);
  const dismissToast = useUiStore((state) => state.dismissToast);
  const image = useProxiedImageUrl(toast?.image);

  useEffect(() => {
    if (!toast) return;

    const timeoutId = window.setTimeout(dismissToast, toast.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [dismissToast, toast]);

  if (!toast) return null;

  const Icon = toastIcons[toast.variant];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[100] flex max-w-sm items-start gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-high px-4 py-3 text-sm text-chrome-neutral-100"
    >
      {image ? (
        <img
          src={image}
          alt=""
          className={`shrink-0 rounded-lg bg-surface-container object-cover ${
            toast.imageShape === "square" ? "h-10 w-10" : "h-10 w-[72px]"
          }`}
        />
      ) : (
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${toastIconStyles[toast.variant]}`} />
      )}
      <div className="min-w-0">
        {toast.title ? (
          <p className="font-medium text-chrome-neutral-100">{toast.title}</p>
        ) : null}
        <p className="text-chrome-neutral-300">{toast.message}</p>
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onSelect();
            dismissToast();
          }}
          className="shrink-0 rounded-full px-2 py-0.5 font-medium text-[var(--color-primary)] transition-colors hover:bg-surface-container-highest"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={getString("toast_dismiss")}
        onClick={dismissToast}
        className="ml-1 rounded-full p-1 text-chrome-neutral-500 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-200"
      >
        <X size={14} />
      </button>
    </div>
  );
}
