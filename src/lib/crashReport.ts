import { useCallback, useEffect, useState } from "react";

import { useUiStore } from "../store/useUiStore";
import { isTauriEnv } from "./api/env";
import { deleteCrashReport, dismissCrashReport, readCrashReport, type CrashReportFile } from "./api/diagnostics";
import { copyText } from "./clipboard";
import { getString } from "./i18n/index";
import { openExternal } from "./openExternal";
import { formatGraphics, type GraphicsReport } from "./graphicsReport";

export const NEW_ISSUE_URL = "https://github.com/Flow-Tube/Flow-Desktop/issues/new";
export const ISSUE_TEMPLATE = "bug_report.yml";

/** A browser refuses or cuts a much longer link, so the page copies the full report instead. */
const MAX_URL_LOG_CHARS = 1500;
const MAX_URL_ACTUAL_CHARS = 300;
const TITLE_MESSAGE_CHARS = 80;
const UNKNOWN_STEPS = "Not sure. Flow closed by itself and offered this report at the next launch.";
const EXPECTED = "Flow keeps running.";

export interface CrashSummary {
  version: string | null;
  os: string | null;
  time: string | null;
  message: string | null;
  where: string | null;
}

export function parseCrashSummary(report: string): CrashSummary {
  const value = (label: string): string | null => {
    const line = report.split("\n").find((entry) => entry.startsWith(`${label}: `));
    const text = line?.slice(label.length + 2).trim();
    return text ? text : null;
  };
  return { version: value("Version"), os: value("OS"), time: value("Time"), message: value("Message"), where: value("Where") };
}

/** The bug form with what fits in a link filled in; the required text fields come from the crash. */
export function crashIssueUrl(report: string): string {
  const summary = parseCrashSummary(report);
  const error = summary.message ?? "a backend panic";
  const headline = error.length > TITLE_MESSAGE_CHARS ? `${error.slice(0, TITLE_MESSAGE_CHARS - 1)}…` : error;
  const fields: Array<[string, string | null]> = [
    ["template", ISSUE_TEMPLATE],
    ["title", `[Bug]: ${headline}${summary.where ? ` in ${summary.where}` : ""}`],
    ["app-version", summary.version],
    ["os-version", summary.os],
    ["steps", UNKNOWN_STEPS],
    ["expected", EXPECTED],
    ["actual", `Flow crashed with ${error}`.slice(0, MAX_URL_ACTUAL_CHARS)],
    ["logs", report.slice(0, MAX_URL_LOG_CHARS)],
  ];
  const query = fields
    .filter((field): field is [string, string] => field[1] !== null)
    .map(([key, text]) => `${key}=${encodeURIComponent(text)}`)
    .join("&");
  return `${NEW_ISSUE_URL}?${query}`;
}

/** The bug form, with what Flow knows about this Linux launch's graphics already filled in. */
export function bugReportUrl(graphics: GraphicsReport | null): string {
  const fields: Array<[string, string]> = [["template", ISSUE_TEMPLATE]];
  if (graphics) {
    fields.push(["webview", `WebKitGTK ${graphics.webkitgtk}`]);
    fields.push(["graphics", [formatGraphics(graphics), graphics.decoders].filter(Boolean).join("; ")]);
  }
  return `${NEW_ISSUE_URL}?${fields.map(([key, text]) => `${key}=${encodeURIComponent(text)}`).join("&")}`;
}

/** Copies the full report, since a link only fits the top of it, and opens the bug form. */
export async function sendCrashReport(report: string): Promise<void> {
  const copied = await copyText(report);
  await openExternal(crashIssueUrl(report));
  useUiStore.getState().showToast({
    variant: "success",
    message: getString(copied ? "crash_report_copied" : "crash_report_opened"),
  });
}

export interface CrashReportState {
  file: CrashReportFile | null;
  /** Stops offering the report at launch. */
  dismiss: () => void;
  remove: () => Promise<void>;
}

/** The kept report. It only appears once the backend answered, and a failure means there is none to show. */
export function useCrashReport(): CrashReportState {
  const [file, setFile] = useState<CrashReportFile | null>(null);

  useEffect(() => {
    let active = true;
    void isTauriEnv().then(async (inTauri) => {
      if (!inTauri) return;
      const loaded = await readCrashReport().catch(() => null);
      if (active) setFile(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setFile((current) => (current ? { ...current, pending: false } : current));
    void dismissCrashReport().catch((error) => console.warn("Failed to dismiss the crash report", error));
  }, []);

  const remove = useCallback(async () => {
    await deleteCrashReport();
    setFile(null);
  }, []);

  return { file, dismiss, remove };
}
