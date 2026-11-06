import { useEffect } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";

import { isTauriEnv } from "./api/env";
import { CURRENT_WINDOW_LABEL, IS_MAIN_WINDOW } from "./appWindow";
import { runMediaCommand, type MediaCommand } from "./mediaSessionArbiter";
import { MEDIA_COMMAND_EVENT } from "./windowEvents";

/**
 * Runs global media keys and tray clicks the backend sends to this window. A window whose player
 * has since closed passes them on to the main window, which holds the music player.
 */
export function useMediaCommands(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void isTauriEnv()
      .then(async (inTauri) => {
        if (!inTauri || disposed) return;
        const stop = await listen<MediaCommand>(
          MEDIA_COMMAND_EVENT,
          ({ payload }) => {
            if (!runMediaCommand(payload) && !IS_MAIN_WINDOW) void emitTo("main", MEDIA_COMMAND_EVENT, payload).catch(() => {});
          },
          // Without a target, listen() also hears events sent to every other window.
          { target: { kind: "WebviewWindow", label: CURRENT_WINDOW_LABEL } },
        );
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => console.warn("Failed to listen for media commands", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
