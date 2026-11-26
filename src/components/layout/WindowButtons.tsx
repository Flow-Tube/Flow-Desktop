import { Copy, Minus, Square, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useWindowControls } from "../../lib/useWindowControls";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

const LOOK = {
  // Square cells the height of the 32 px title bar.
  titlebar: {
    button: `grid h-full w-[46px] place-items-center text-on-surface-variant transition-colors duration-200 ease-out ${FOCUS}`,
    idle: "hover:bg-on-surface/10 hover:text-on-surface",
  },
  // Round buttons beside the top bar's other icons.
  topbar: {
    button: `grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out ${FOCUS}`,
    idle: "hover:bg-surface-container-high hover:text-chrome-neutral-100",
  },
} as const;

/** Minimize, maximize or restore, and close, for the windows Flow draws without system chrome. */
export function WindowButtons({ variant }: { variant: keyof typeof LOOK }) {
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  const look = LOOK[variant];
  return (
    <div className={`relative z-10 flex items-center ${variant === "titlebar" ? "h-full" : "gap-1"}`}>
      <button type="button" aria-label={getString("window_minimize")} onClick={minimize} className={`${look.button} ${look.idle}`}>
        <Minus size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={getString(isMaximized ? "window_restore" : "window_maximize")}
        onClick={toggleMaximize}
        className={`${look.button} ${look.idle}`}
      >
        {isMaximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
      </button>
      <button
        type="button"
        aria-label={getString("window_close")}
        onClick={close}
        className={`${look.button} hover:bg-primary hover:text-chrome-white`}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
