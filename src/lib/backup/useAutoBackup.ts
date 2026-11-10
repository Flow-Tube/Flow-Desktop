import { useCallback, useEffect, useState } from "react";

import { getAutoBackupStatus, runAutoBackupNow, type AutoBackupStatus } from "../api/backup";

export type BackUpOutcome = "done" | "busy" | "folder_missing" | "failed";

const IDLE: AutoBackupStatus = { lastRunMs: 0, lastError: null, running: false };

/** The schedule's last run, and Back up now. The status stays at its default if it can't be read. */
export function useAutoBackup() {
  const [status, setStatus] = useState<AutoBackupStatus>(IDLE);
  const [backingUp, setBackingUp] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getAutoBackupStatus().catch(() => null);
    if (next) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backUpNow = useCallback(async (): Promise<BackUpOutcome> => {
    setBackingUp(true);
    try {
      const started = await runAutoBackupNow().catch(() => null);
      const latest = await refresh();
      if (started === false) return "busy";
      if (started === true) return "done";
      return latest?.lastError === "folder_missing" ? "folder_missing" : "failed";
    } finally {
      setBackingUp(false);
    }
  }, [refresh]);

  return { status, backingUp: backingUp || status.running, backUpNow };
}
