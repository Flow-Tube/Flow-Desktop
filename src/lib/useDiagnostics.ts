import { useCallback, useEffect, useState } from "react";
import { clearLogs, getLogsDir, readLogs } from "./api/diagnostics";
import { getBackendErrorMessage } from "./api/errors";
import { clearDiagnosticEvents, getDiagnosticEvents } from "./diagnostics";

function formatInAppEvents(): string {
  const events = getDiagnosticEvents();
  if (events.length === 0) return "";
  const lines = events.map((event) => `${event.at}  [${event.scope}]  ${event.message}`);
  return `===== In-app events (${events.length}) =====\n${lines.join("\n")}`;
}

export interface DiagnosticsState {
  /** Combined backend file log + in-app event buffer, ready to copy. */
  text: string;
  /** Absolute path of the log directory, for the "open folder" fallback. */
  logsDir: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Loads the persisted backend logs and merges them with the frontend's in-memory
 * event buffer (which holds the freshest events, some not yet flushed to disk).
 * All backend access is wrapped here so the page stays free of `invoke` calls.
 */
export function useDiagnostics(): DiagnosticsState {
  const [fileLogs, setFileLogs] = useState("");
  const [logsDir, setLogsDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The dir lookup is a best-effort convenience; never let it fail the load.
      const [logs, dir] = await Promise.all([readLogs(), getLogsDir().catch(() => "")]);
      setFileLogs(logs);
      setLogsDir(dir);
    } catch (caught) {
      setError(getBackendErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      await clearLogs();
    } catch (caught) {
      setError(getBackendErrorMessage(caught));
    } finally {
      clearDiagnosticEvents();
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const text = [fileLogs.trim(), formatInAppEvents()].filter(Boolean).join("\n\n");

  return { text, logsDir, loading, error, refresh, clear };
}
