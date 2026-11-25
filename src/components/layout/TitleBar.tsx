import { getString } from "../../lib/i18n/index";
import { IS_MACOS_RUNTIME } from "../../lib/platform";
import { useNativeWindowTitle } from "../../lib/useNativeWindowTitle";
import { useResolvedWindowTitle } from "../../lib/useResolvedWindowTitle";
import { useWindowControls } from "../../lib/useWindowControls";
import { WindowResizeEdges } from "../ui/WindowResizeEdges";
import { WindowButtons } from "./WindowButtons";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Flow's own title bar on Linux and Windows, where the window has no system chrome. The window
 * title and the resize edges stay even when the bar itself is hidden (Settings > Appearance >
 * Window buttons).
 */
export function TitleBar({ shown }: { shown: boolean }) {
  const { text, section } = useResolvedWindowTitle();
  const { isMaximized, isFullscreen } = useWindowControls();
  useNativeWindowTitle(text || getString('app_name'));

  if (IS_MACOS_RUNTIME) return null;

  return (
    <>
      {shown && (
        <div className="relative z-[100] flex h-[var(--app-titlebar-height)] shrink-0 select-none items-center border-b border-outline-variant/60 bg-background">
          <div data-tauri-drag-region className="absolute inset-0" />

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-40">
            {text && (
              <span dir="auto"
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

          <div className="ms-auto h-full">
            <WindowButtons variant="titlebar" />
          </div>
        </div>
      )}
      {/* A maximized or fullscreen window can't be resized, so its edges would
          only show a resize cursor over controls that still look clickable (#75). */}
      {!isMaximized && !isFullscreen && <WindowResizeEdges />}
    </>
  );
}
