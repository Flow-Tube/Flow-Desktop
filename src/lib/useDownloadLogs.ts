import { useEffect, useState } from "react";

import { getDownloadLogs, type DownloadStatus } from "./api/downloads";

const RUNNING_REFRESH_MS = 2000;

/** A download's log lines, read when the details view opens and kept fresh while
 *  it runs. Logs stay in the backend so progress events stay small. */
export function useDownloadLogs(id: string, status: DownloadStatus | undefined): string[] {
  const [logs, setLogs] = useState<string[]>([]);
  const running = status !== undefined && status !== "completed" && status !== "failed" && status !== "cancelled";

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getDownloadLogs(id)
        .then((lines) => {
          if (!cancelled) setLogs(lines);
        })
        .catch(() => {});
    };
    load();
    const timer = running ? window.setInterval(load, RUNNING_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [id, running, status]);

  return logs;
}
