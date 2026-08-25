import { Maximize2, Pin, PinOff, X } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { usePipSession } from "../../lib/usePipSession";
import { usePipWindowAspectLock } from "../../lib/usePipWindowAspectLock";
import { useMediaSessionMetadata } from "../../lib/useMediaSessionMetadata";
import { usePlayerStore } from "../../store/usePlayerStore";
import { WindowResizeEdges } from "../ui/WindowResizeEdges";
import { FlowPlayerCore } from "../watch/FlowPlayerCore";

const chromeButton =
  "grid h-7 w-7 shrink-0 place-items-center rounded-full text-chrome-white/90 transition-colors hover:bg-chrome-white/15 hover:text-chrome-white";

/**
 * Root of the pop-out player window — a real top-level OS window that can be
 * moved to another monitor, pinned above other apps, and closed without
 * disturbing the main window. It renders the same player as the watch page,
 * driven by the handoff `usePipSession` hydrates.
 */
export function PipWindowApp() {
  const { status, alwaysOnTop, toggleAlwaysOnTop, returnToMainWindow, closeWindow } =
    usePipSession();
  usePipWindowAspectLock();

  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const isPlaying = status === "playing" && !!currentVideo;
  // This window holds the media element while it is open, so it also owns the
  // OS transport controls.
  useMediaSessionMetadata(isPlaying);

  return (
    <div className="group relative flex h-screen w-screen items-center justify-center overflow-hidden bg-chrome-black text-chrome-zinc-100">
      {isPlaying ? (
        // Widest 16:9 box that still fits the window, so the transport controls
        // stay inside the frame even mid-resize.
        <div className="w-full max-w-[calc(100vh*16/9)]">
          <FlowPlayerCore videoId={currentVideo.id} videoDetails={null} />
        </div>
      ) : (
        <div
          data-tauri-drag-region
          className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
        >
          {status === "loading" ? (
            <>
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-chrome-zinc-400">{getString("pip_window_loading")}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-chrome-zinc-400">{getString("pip_window_empty")}</p>
              <button
                type="button"
                onClick={() => void closeWindow()}
                className="rounded-full border border-outline-variant px-4 py-1.5 text-xs font-medium text-chrome-zinc-200 transition-colors hover:bg-chrome-white/10"
              >
                {getString("pip_window_close")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Title strip doubles as the drag handle; the OS gives an undecorated
          window no titlebar of its own to move it by. */}
      <div className="absolute inset-x-0 top-0 z-[250] flex h-9 items-center gap-1 px-2 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100">
        <div
          data-tauri-drag-region
          className="flex h-full min-w-0 flex-1 items-center rounded-lg px-2"
        >
          <span className="pointer-events-none truncate text-xs font-medium text-chrome-white">
            {currentVideo?.title ?? getString("pip_window_title")}
          </span>
        </div>
        <button
          type="button"
          aria-label={
            alwaysOnTop ? getString("pip_window_unpin") : getString("pip_window_pin")
          }
          title={alwaysOnTop ? getString("pip_window_unpin") : getString("pip_window_pin")}
          onClick={toggleAlwaysOnTop}
          className={
            alwaysOnTop ? `${chromeButton} bg-chrome-white/15 text-chrome-white` : chromeButton
          }
        >
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button
          type="button"
          aria-label={getString("pip_window_return")}
          title={getString("pip_window_return")}
          onClick={() => void returnToMainWindow()}
          className={chromeButton}
        >
          <Maximize2 size={15} />
        </button>
        <button
          type="button"
          aria-label={getString("pip_window_close")}
          title={getString("pip_window_close")}
          onClick={() => void closeWindow()}
          className={chromeButton}
        >
          <X size={16} />
        </button>
      </div>

      <WindowResizeEdges zIndexClass="z-[300]" />
    </div>
  );
}
