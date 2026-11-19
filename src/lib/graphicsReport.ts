import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriEnv } from "./api/env";

/** What this Linux launch did about graphics; see `linux_system::GraphicsReport`. */
export interface GraphicsReport {
  tier: number;
  tierReason: string;
  /** How this tier gets the page to the screen: "gpu", "shared-memory", "software", or "own-variables" when the user's own renderer variables decide it. */
  renderPath: string;
  /** What a faster-graphics trial can do here: "none", "trial" (this launch is one), "available" or "suggested". */
  faster: string;
  mode: string;
  session: string;
  x11Backend: boolean;
  packaging: string;
  webkitgtk: string;
  decoders: string | null;
}

// Plain English on purpose: these lines go into bug reports as they are.
const TIER_REASONS: Record<string, string> = {
  default: "default",
  settings: "from Graphics compatibility in Settings",
  "failed-launches": "after launches that did not render",
  "nvidia-wayland": "NVIDIA on Wayland",
  "crash-loop": "after the page kept crashing",
  remembered: "remembered from an earlier launch",
  "safe-graphics-launch": "--safe-graphics launch",
  trial: "faster graphics trial",
  "trial-kept": "kept after a faster graphics trial",
  "own-variables": "started with your own variables",
};

const RENDER_PATHS: Record<string, string> = {
  gpu: "GPU",
  "shared-memory": "GPU through shared memory",
  software: "no GPU",
  "own-variables": "path set by your WebKitGTK variables",
};

const MODES: Record<string, string> = { automatic: "Automatic", compatible: "Compatible", safe: "Safe" };

/** One line for the About tab and a bug report, such as "Tier 1 (NVIDIA on Wayland), GPU through shared memory, Automatic mode, wayland, appimage, WebKitGTK 2.48.3". */
export function formatGraphics(report: GraphicsReport): string {
  const reason = TIER_REASONS[report.tierReason] ?? report.tierReason;
  const session = report.session || "unknown session";
  const drawnThrough = report.x11Backend && report.session !== "x11" ? `${session} drawn through X11` : session;
  return [
    `Tier ${report.tier} (${reason})`,
    RENDER_PATHS[report.renderPath] ?? report.renderPath,
    `${MODES[report.mode] ?? report.mode} mode`,
    drawnThrough,
    report.packaging,
    `WebKitGTK ${report.webkitgtk}`,
  ].join(", ");
}

let cached: Promise<GraphicsReport | null> | null = null;

/** Null off Linux and outside Flow. The decoder probe can still be running on a first call. */
export function getGraphicsReport(): Promise<GraphicsReport | null> {
  cached ??= isTauriEnv()
    .then((tauri) => (tauri ? invoke<GraphicsReport | null>("graphics_report") : null))
    .then((report) => {
      // Asked again later, the probe may have finished.
      if (report && !report.decoders) cached = null;
      return report;
    })
    .catch(() => {
      cached = null;
      return null;
    });
  return cached;
}

/** On a tier that copies every frame, or draws without the GPU, an effect that repaints a large area costs too much. A path the user's own variables set is unknown, so it counts as slow. */
export function isSlowRenderPath(report: GraphicsReport | null): boolean {
  return Boolean(report) && report?.renderPath !== "gpu";
}

/** False until the report says otherwise, and always off Linux. */
export function useSlowRenderPath(): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let active = true;
    void getGraphicsReport().then((report) => {
      if (active) setSlow(isSlowRenderPath(report));
    });
    return () => {
      active = false;
    };
  }, []);
  return slow;
}

/** GTK3 can't keep a window above others on Wayland, so pinning does nothing there. */
export function canPinWindows(report: GraphicsReport | null): boolean {
  return !(report && report.session === "wayland" && !report.x11Backend);
}

/** True until the report says otherwise, and always off Linux. */
export function useCanPinWindows(): boolean {
  const [canPin, setCanPin] = useState(true);
  useEffect(() => {
    let active = true;
    void getGraphicsReport().then((report) => {
      if (active) setCanPin(canPinWindows(report));
    });
    return () => {
      active = false;
    };
  }, []);
  return canPin;
}
