import { getAppMetadata } from "./appMetadata";
import { getSystemMetadata } from "./systemMetadata";
import { formatDiagnosticEvent, getDiagnosticEvents, recordDiagnostic } from "./diagnostics";
import type { PlayerErrorInfo } from "./playerError";

export function recordPlayerEvent(message: string): void {
  recordDiagnostic("player", message);
}

export interface PlayerReportContext {
  surface: "video" | "music";
  error: PlayerErrorInfo;
  videoId?: string | null;
  title?: string | null;
  watchUrl?: string | null;
  details?: Record<string, unknown>;
}

function section(heading: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter((line): line is string => Boolean(line && line.length));
  if (body.length === 0) return "";
  return `${heading}\n${body.map((line) => `  ${line}`).join("\n")}`;
}

/**
 * Builds a formatted, human-readable diagnostics report for the given failure.
 * Safe to call outside Tauri (falls back to browser metadata).
 */
export async function buildPlayerReport(ctx: PlayerReportContext): Promise<string> {
  const [app, sys] = await Promise.all([getAppMetadata(), getSystemMetadata()]);

  const environment = section("Environment", [
    `${app.name} ${app.version} (${app.bundleType})`,
    `Identifier: ${app.identifier}`,
    `Tauri: ${app.tauriVersion}`,
    `OS: ${sys.osType} ${sys.osVersion} (${sys.platform}, ${sys.arch})`,
    `Locale: ${sys.locale}`,
    `User agent: ${sys.userAgent}`,
  ]);

  const detailLines = Object.entries(ctx.details ?? {}).map(
    ([key, value]) => `${key}: ${String(value)}`,
  );

  const failure = section("Failure", [
    `Surface: ${ctx.surface}`,
    `Kind: ${ctx.error.kind}`,
    `Title: ${ctx.error.title}`,
    `Message: ${ctx.error.rawMessage}`,
    `Retryable: ${ctx.error.retryable}`,
    ctx.videoId ? `Video ID: ${ctx.videoId}` : null,
    ctx.title ? `Content: ${ctx.title}` : null,
    ctx.watchUrl ? `URL: ${ctx.watchUrl}` : null,
    ...detailLines,
  ]);

  const recentEvents = section(
    "Recent events",
    getDiagnosticEvents().slice(-40).map(formatDiagnosticEvent),
  );

  return [`Flow Desktop — playback diagnostics`, environment, failure, recentEvents]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Builds the report and copies it to the clipboard. Returns `true` on success
 * so callers can toast the outcome.
 */
export async function copyPlayerReport(ctx: PlayerReportContext): Promise<boolean> {
  try {
    const report = await buildPlayerReport(ctx);
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(report);
    return true;
  } catch (error) {
    console.warn("Failed to copy player diagnostics", error);
    return false;
  }
}
