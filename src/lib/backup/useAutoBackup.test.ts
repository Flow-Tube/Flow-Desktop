import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAutoBackupStatus = vi.fn();
const runAutoBackupNow = vi.fn();
vi.mock("../api/backup", () => ({
  getAutoBackupStatus: () => getAutoBackupStatus(),
  runAutoBackupNow: () => runAutoBackupNow(),
}));

import { useAutoBackup } from "./useAutoBackup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const result: { current: ReturnType<typeof useAutoBackup> | null } = { current: null };
  const Probe = () => {
    result.current = useAutoBackup();
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  return result as { current: ReturnType<typeof useAutoBackup> };
}

describe("useAutoBackup", () => {
  beforeEach(() => {
    getAutoBackupStatus.mockReset();
    runAutoBackupNow.mockReset();
  });

  it("shows the last run", async () => {
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 42, lastError: null, running: false });
    const hook = await mount();
    expect(hook.current.status.lastRunMs).toBe(42);
    expect(hook.current.backingUp).toBe(false);
  });

  it("keeps its default when the status can't be read", async () => {
    getAutoBackupStatus.mockRejectedValue(new Error("no backend"));
    const hook = await mount();
    expect(hook.current.status.lastRunMs).toBe(0);
  });

  it("says when a backup is already running", async () => {
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 0, lastError: null, running: false });
    runAutoBackupNow.mockResolvedValue(false);
    const hook = await mount();
    let outcome;
    await act(async () => {
      outcome = await hook.current.backUpNow();
    });
    expect(outcome).toBe("busy");
  });

  it("tells a missing folder from another failure", async () => {
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 0, lastError: null, running: false });
    runAutoBackupNow.mockRejectedValue(new Error("folder_missing"));
    const hook = await mount();
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 0, lastError: "folder_missing", running: false });
    let outcome;
    await act(async () => {
      outcome = await hook.current.backUpNow();
    });
    expect(outcome).toBe("folder_missing");

    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 0, lastError: "failed", running: false });
    await act(async () => {
      outcome = await hook.current.backUpNow();
    });
    expect(outcome).toBe("failed");
    expect(hook.current.backingUp).toBe(false);
  });

  it("reports a finished backup and its new time", async () => {
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 0, lastError: null, running: false });
    runAutoBackupNow.mockResolvedValue(true);
    const hook = await mount();
    getAutoBackupStatus.mockResolvedValue({ lastRunMs: 99, lastError: null, running: false });
    let outcome;
    await act(async () => {
      outcome = await hook.current.backUpNow();
    });
    expect(outcome).toBe("done");
    expect(hook.current.status.lastRunMs).toBe(99);
  });
});
