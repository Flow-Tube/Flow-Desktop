import { beforeEach, describe, expect, it, vi } from "vitest";

const pickSaveFile = vi.fn();
const exportBackupFile = vi.fn();
vi.mock("../dialogs", () => ({ pickSaveFile: (...args: unknown[]) => pickSaveFile(...args) }));
vi.mock("../api/backup", () => ({ exportBackupFile: (...args: unknown[]) => exportBackupFile(...args) }));

import { backupFileName, saveBackupFile } from "./exportFile";

describe("backup files", () => {
  beforeEach(() => {
    pickSaveFile.mockReset();
    exportBackupFile.mockReset();
  });

  it("offers Android's file names, a zip for a master backup", () => {
    expect(backupFileName("MASTER", 5)).toBe("flow_master_backup_5.zip");
    expect(backupFileName("BRAIN", 5)).toBe("flow_brain_backup_5.zip");
    expect(backupFileName("APP_DATA", 5)).toBe("flow_backup_5.json");
    expect(backupFileName("NEWPIPE_SUBSCRIPTIONS", 5)).toBe("newpipe_subscriptions_5.json");
    expect(backupFileName("WATCH_HISTORY", 5)).toBe("flow-watch-history.json");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    pickSaveFile.mockResolvedValue(null);
    await expect(saveBackupFile("MASTER", "Export")).resolves.toBeNull();
    expect(exportBackupFile).not.toHaveBeenCalled();
  });

  it("limits the dialog to the kind's file type and writes where the viewer chose", async () => {
    pickSaveFile.mockResolvedValue("/tmp/x.zip");
    exportBackupFile.mockResolvedValue({ skipped: 0 });
    await expect(saveBackupFile("MASTER", "Export")).resolves.toEqual({ skipped: 0 });
    expect(pickSaveFile.mock.calls[0]?.[2]).toEqual([{ name: "ZIP", extensions: ["zip"] }]);
    expect(exportBackupFile).toHaveBeenCalledWith("MASTER", "/tmp/x.zip");
  });
});
