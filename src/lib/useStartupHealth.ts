import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Tells the backend the webview mounted and rendered, clearing the Linux
 * startup-crash sentinel (see src-tauri/src/linux_startup.rs) so the next launch
 * starts at workaround tier 0. A no-op outside Tauri and on non-Linux; failures
 * are swallowed — a health signal must never itself break startup.
 */
export function useStartupHealth(): void {
  useEffect(() => {
    void invoke("startup_render_ok").catch(() => {});
  }, []);
}
