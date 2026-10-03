import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MACOS_RUNTIME } from "./platform";
import { logToBackend } from "./diagnostics";

export function useNativeWindowTitle(title: string) {
  useEffect(() => {
    if (!IS_MACOS_RUNTIME) return;
    void getCurrentWindow().setTitle(title).catch((cause) => {
      void logToBackend("warn", "native window title failed", { cause: String(cause) });
    });
  }, [title]);
}
