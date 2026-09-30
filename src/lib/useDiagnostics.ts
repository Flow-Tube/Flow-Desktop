import { useCallback, useEffect, useState } from "react";
import { clearLogs, getLogsDir, readLogs } from "./api/diagnostics";
import { getBackendErrorMessage } from "./api/errors";
import { getMusicRequestDiagnostics, type MusicRequestDiagnostics } from "./api/music";
import { clearDiagnosticEvents, formatDiagnosticEvent, getDiagnosticEvents } from "./diagnostics";

function formatInAppEvents(): string {
  const events = getDiagnosticEvents();
  if (events.length === 0) return "";
  const lines = events.map(formatDiagnosticEvent);
  return `===== In-app events (${events.length}) =====\n${lines.join("\n")}`;
}

/** Anonymous music request totals since launch; counts and timings only, never tokens. */
function formatMusicRequests(stats: MusicRequestDiagnostics | null): string {
  if (!stats) return "";
  const average = stats.requests > 0 ? Math.round(stats.requestMillis / stats.requests) : 0;
  return [
    "===== Music requests since launch =====",
    `Innertube requests: ${stats.requests} (avg ${average}ms)`,
    `Served from local cache: ${stats.publicCacheHits}`,
  ].join("\n");
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
  const [musicRequests, setMusicRequests] = useState<MusicRequestDiagnostics | null>(null);
  const [logsDir, setLogsDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The dir lookup is a best-effort convenience; never let it fail the load.
      const [logs, dir, music] = await Promise.all([
        readLogs(),
        getLogsDir().catch(() => ""),
        getMusicRequestDiagnostics().catch(() => null),
      ]);
      setFileLogs(logs);
      setLogsDir(dir);
      setMusicRequests(music);
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

  const text = [fileLogs.trim(), formatInAppEvents(), formatMusicRequests(musicRequests)]
    .filter(Boolean)
    .join("\n\n");

  return { text, logsDir, loading, error, refresh, clear };
}
