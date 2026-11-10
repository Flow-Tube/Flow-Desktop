import { invokeBackend } from "./errors";

/** Returns the tail of the persisted backend rolling log files as plain text. */
export function readLogs(): Promise<string> {
  return invokeBackend<string>("read_logs");
}

/** Deletes rolled log files and truncates the active one. */
export function clearLogs(): Promise<void> {
  return invokeBackend<void>("clear_logs");
}

/** Absolute path of the rolling log directory */
export function getLogsDir(): Promise<string> {
  return invokeBackend<string>("logs_dir_path");
}

/** Opens the rolling log directory in the OS file manager. */
export function revealLogsFolder(): Promise<void> {
  return invokeBackend<void>("reveal_logs_folder");
}

/** Forgets the anonymous visitor identity sent to YouTube; the next request gets a new one. */
export function resetVisitorIdentity(): Promise<void> {
  return invokeBackend<void>("reset_visitor_identity");
}

export interface CrashReportFile {
  report: string;
  /** Not answered yet, so the next launch offers it. */
  pending: boolean;
}

/** The report the last backend crash left, if any. */
export function readCrashReport(): Promise<CrashReportFile | null> {
  return invokeBackend<CrashReportFile | null>("crash_report_read");
}

/** Stops offering the report at launch; it stays on the Diagnostics page. */
export function dismissCrashReport(): Promise<void> {
  return invokeBackend<void>("crash_report_dismiss");
}

export function deleteCrashReport(): Promise<void> {
  return invokeBackend<void>("crash_report_delete");
}
