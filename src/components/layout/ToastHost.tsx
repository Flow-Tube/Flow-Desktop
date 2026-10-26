import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Toast } from "../ui/Toast";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useToastTimer } from "../../lib/useToastTimer";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useUiStore, type ToastState } from "../../store/useUiStore";

// The music dock is 72 px tall and sits 24 px up; toasts clear it by 12 px.
const BOTTOM_PX = 24;
const ABOVE_DOCK_PX = 24 + 72 + 12;

function ToastItem({ toast }: { toast: ToastState }) {
  const dismissToast = useUiStore((s) => s.dismissToast);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const image = useProxiedImageUrl(toast.image);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useCallback(() => dismissToast(toast.id), [dismissToast, toast.id]);
  useToastTimer(toast.durationMs, hovered || focused, dismiss);

  // A View button for the page already open would do nothing.
  const actions = toast.actions.filter((action) => !action.to || action.to !== pathname);

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Toast
        title={toast.title}
        message={toast.message}
        variant={toast.variant}
        image={image}
        imageShape={toast.imageShape}
        actionLabels={actions.map((action) => action.label)}
        onAction={(index) => {
          const action = actions[index];
          if (!action) return;
          dismiss();
          action.onSelect?.();
          if (action.to) navigate(action.to);
        }}
        onDismiss={dismiss}
      />
    </div>
  );
}

export function ToastHost() {
  const toast = useUiStore((s) => s.toast);
  const dockVisible = useMusicPlayerStore((s) => s.currentTrack !== null && s.viewState === "dock");
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-6 z-[100] w-[360px] max-w-[calc(100vw-3rem)] transition-[bottom] duration-200 ease-out"
      style={{ bottom: dockVisible ? ABOVE_DOCK_PX : BOTTOM_PX }}
    >
      <AnimatePresence initial={false}>
        {toast ? (
          <motion.div
            key={toast.id}
            className="pointer-events-auto absolute bottom-0 right-0 w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] } }}
            exit={{ opacity: 0, y: 8, transition: { duration: reduceMotion ? 0 : 0.15, ease: [0.3, 0, 1, 1] } }}
          >
            <ToastItem toast={toast} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
