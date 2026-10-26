import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import type { ToastImageShape, ToastVariant } from "../../store/useUiStore";

const variantIcons: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const variantIconStyles: Record<ToastVariant, string> = {
  success: "text-[var(--color-primary)]",
  error: "text-chrome-red-400",
  info: "text-chrome-neutral-300",
};

const posterSizes: Record<ToastImageShape, string> = {
  landscape: "h-9 w-16",
  square: "h-11 w-11",
  portrait: "h-[52px] w-[30px]",
};

type ToastProps = {
  title?: string;
  message: string;
  variant: ToastVariant;
  image?: string | null;
  imageShape?: ToastImageShape;
  actionLabels: string[];
  onAction: (index: number) => void;
  onDismiss: () => void;
};

export function Toast({ title, message, variant, image, imageShape = "landscape", actionLabels, onAction, onDismiss }: ToastProps) {
  const Icon = variantIcons[variant];

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-2.5 text-sm text-chrome-neutral-100">
      {image ? (
        <img
          src={image}
          alt=""
          className={`shrink-0 rounded-lg bg-surface-container object-cover ${posterSizes[imageShape]}`}
        />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-highest">
          <Icon className={`h-4 w-4 ${variantIconStyles[variant]}`} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title ? <p className="truncate font-medium text-chrome-neutral-100">{title}</p> : null}
        <p className={title ? "truncate text-chrome-neutral-300" : "line-clamp-2 text-chrome-neutral-200"}>{message}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actionLabels.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => onAction(index)}
            className={`rounded-full px-3 py-1.5 font-medium transition-colors duration-200 ease-out hover:bg-surface-container-highest ${
              index === actionLabels.length - 1 ? "text-[var(--color-primary)]" : "text-chrome-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
        {actionLabels.length < 2 ? (
          <button
            type="button"
            aria-label={getString("toast_dismiss")}
            onClick={onDismiss}
            className="rounded-full p-1.5 text-chrome-neutral-500 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-200"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
