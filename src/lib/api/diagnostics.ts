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
