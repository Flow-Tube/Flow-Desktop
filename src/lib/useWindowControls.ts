import { useEffect, useState } from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { IS_MACOS_RUNTIME } from "./platform";
import { logToBackend } from "./diagnostics";

function reportFailure(cause: unknown) {
  void logToBackend("warn", "window control failed", { cause: String(cause) });
}

function runWindowAction(action: (window: Window) => Promise<void>) {
  void Promise.resolve().then(() => action(getCurrentWindow())).catch(reportFailure);
}

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (IS_MACOS_RUNTIME) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      const appWindow = getCurrentWindow();
      let observation = 0;
      const refresh = async () => {
        const currentObservation = ++observation;
        const maximized = await appWindow.isMaximized();
        if (!disposed && currentObservation === observation) setIsMaximized(maximized);
      };
      const dispose = await appWindow.onResized(() => {
        void refresh().catch(reportFailure);
      });
      if (disposed) dispose();
      else {
        unlisten = dispose;
        await refresh();
      }
    };
    void setup().catch(reportFailure);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    isMaximized,
    minimize: () => runWindowAction((window) => window.minimize()),
    toggleMaximize: () => runWindowAction((window) => window.toggleMaximize()),
    close: () => runWindowAction((window) => window.close()),
  };
}
