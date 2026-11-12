import { invoke } from "@tauri-apps/api/core";
import { isTauriEnv } from "./api/env";

/** What this Linux launch did about graphics; see `linux_system::GraphicsReport`. */
export interface GraphicsReport {
  tier: number;
  tierReason: string;
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
  remembered: "remembered from an earlier launch",
  "safe-graphics-launch": "--safe-graphics launch",
};

const MODES: Record<string, string> = { automatic: "Automatic", compatible: "Compatible", safe: "Safe" };

/** One line for the About tab and a bug report, such as "Tier 1 (NVIDIA on Wayland), Automatic, Wayland, AppImage, WebKitGTK 2.48.3". */
export function formatGraphics(report: GraphicsReport): string {
  const reason = TIER_REASONS[report.tierReason] ?? report.tierReason;
  const session = report.session || "unknown session";
  const drawnThrough = report.x11Backend && report.session !== "x11" ? `${session} drawn through X11` : session;
  return [
    `Tier ${report.tier} (${reason})`,
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
