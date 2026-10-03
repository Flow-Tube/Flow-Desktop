import { useTranslation } from "react-i18next";
import { Copy, Minus, Square, X } from "lucide-react";
import { IS_MACOS_RUNTIME } from "../../lib/platform";
import { useNativeWindowTitle } from "../../lib/useNativeWindowTitle";
import { useResolvedWindowTitle } from "../../lib/useResolvedWindowTitle";
import { useWindowControls } from "../../lib/useWindowControls";
import { WindowResizeEdges } from "../ui/WindowResizeEdges";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function TitleBar() {
  const { t } = useTranslation();
  const { text, section } = useResolvedWindowTitle();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
  useNativeWindowTitle(text || t("appName"));

  if (IS_MACOS_RUNTIME) return null;

  const controlBtn =
    "grid h-full w-[46px] place-items-center text-on-surface-variant transition-colors";

  return (
    <>
      <div className="relative z-[100] flex h-[var(--app-titlebar-height)] shrink-0 select-none items-center border-b border-outline-variant/60 bg-background">
        <div data-tauri-drag-region className="absolute inset-0" />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-40">
          {text && (
            <span
              className={cx(
                "max-w-full truncate text-center text-xs",
                section
                  ? "font-semibold uppercase tracking-[0.14em] text-on-surface-variant"
                  : "font-medium tracking-wide text-on-surface"
              )}
            >
              {text}
            </span>
          )}
        </div>

        {/* Window controls */}
        <div className="relative z-10 ml-auto flex h-full items-center">
          <button
            type="button"
            aria-label={t("windowMinimize")}
            onClick={minimize}
            className={`${controlBtn} hover:bg-on-surface/10 hover:text-on-surface`}
          >
            <Minus size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label={t(isMaximized ? "windowRestore" : "windowMaximize")}
            onClick={toggleMaximize}
            className={`${controlBtn} hover:bg-on-surface/10 hover:text-on-surface`}
          >
            {isMaximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
          </button>
          <button
            type="button"
            aria-label={t("windowClose")}
            onClick={close}
            className={`${controlBtn} hover:bg-primary hover:text-chrome-white`}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <WindowResizeEdges />
    </>
  );
}
