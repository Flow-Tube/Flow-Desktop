import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { TabRouter } from "./components/layout/TabRouter";
import { PipWindowApp } from "./components/pip/PipWindowApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PIP_WINDOW_LABEL } from "./lib/api/pip";
import { IS_LINUX_RUNTIME } from "./lib/platform";

// Read by App.css to hold endless animations still and snap the shell's layout motion.
if (IS_LINUX_RUNTIME) document.documentElement.dataset.lightEffects = "true";

// Both windows load the same bundle; the window label decides which root runs.
// The pop-out player deliberately stays outside the router — it is one surface,
// not an app, and mounting the full shell there would duplicate every global
// controller the main window already owns.
const isPopoutPlayerWindow = (() => {
  try {
    return getCurrentWindow().label === PIP_WINDOW_LABEL;
  } catch {
    return false;
  }
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPopoutPlayerWindow ? (
        <PipWindowApp />
      ) : (
        <TabRouter>
          <App />
        </TabRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
