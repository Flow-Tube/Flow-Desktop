import { beforeEach, describe, expect, it, vi } from "vitest";

const readBackupFile = vi.fn();
const importBackupCollections = vi.fn();
const restoreMasterProfiles = vi.fn();
const runOtherAppImport = vi.fn();
const refreshAfterRestore = vi.fn();
const confirmAction = vi.fn();
const setSettingValue = vi.fn();
const subscribe = vi.fn();
const showToast = vi.fn();
let profilesView: unknown = null;

vi.mock("../api/backup", () => ({ readBackupFile: (...args: unknown[]) => readBackupFile(...args) }));
vi.mock("../api/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn(), addWatchRecordsBulk: vi.fn() }));
vi.mock("../api/recommendation", () => ({
  bootstrapFromHistory: vi.fn(),
  bootstrapFromSubscriptions: vi.fn(),
  importBrain: vi.fn(),
}));
vi.mock("../api/youtube", () => ({ parseSubscriptionExport: vi.fn(async () => []) }));
vi.mock("../dialogs", () => ({ confirmAction: (...args: unknown[]) => confirmAction(...args) }));
vi.mock("../settings/backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/backup")>()),
  importBackupCollections: (...args: unknown[]) => importBackupCollections(...args),
}));
vi.mock("../settings/masterRestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/masterRestore")>()),
  restoreMasterProfiles: (...args: unknown[]) => restoreMasterProfiles(...args),
}));
vi.mock("../storage/profileStorage", () => ({ activeProfile: () => ({ isDefault: true }) }));
vi.mock("../../store/useAppSettingsStore", () => ({ setSettingValue: (...args: unknown[]) => setSettingValue(...args) }));
vi.mock("../../store/useHistoryStore", () => ({ useHistoryStore: { getState: () => ({ load: vi.fn() }) } }));
vi.mock("../../store/useProfilesStore", () => ({
  useProfilesStore: { getState: () => ({ view: profilesView, load: vi.fn() }) },
}));
vi.mock("../../store/useSubscriptionStore", () => ({ useSubscriptionStore: { getState: () => ({ subscribe }) } }));
vi.mock("../../store/useUiStore", () => ({ useUiStore: { getState: () => ({ showToast }) } }));
vi.mock("./otherAppImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./otherAppImport")>()),
  runOtherAppImport: (...args: unknown[]) => runOtherAppImport(...args),
}));
vi.mock("./refreshAfterRestore", () => ({ refreshAfterRestore: () => refreshAfterRestore() }));

import { IMPORT_EVERYTHING, importFile } from "./importFile";

const COLLECTIONS = {
  watch_history: [{ videoId: "a" }, { videoId: "b" }],
  subscription_channels: [{ channelId: "UC1" }],
  playlists: [{ syncId: "p1" }],
  likes: [{ id: "l1" }],
  flow_neuro_brain: [{ deviceId: "d" }],
};

const summaryOf = (collections: Record<string, unknown[]>) => ({
  collections: Object.entries(collections).map(([collection, records]) => ({
    collection,
    added: records.length,
    updated: 0,
    skipped: 0,
    tombstoned: 0,
  })),
});

describe("importFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profilesView = null;
    importBackupCollections.mockImplementation(async (collections: Record<string, unknown[]>) => summaryOf(collections));
    setSettingValue.mockResolvedValue(true);
  });

  it("restores every collection of a Flow backup, not only its subscriptions", async () => {
    readBackupFile.mockResolvedValue({ type: "backup", data: { schemaVersion: 2, settings: {}, collections: COLLECTIONS } });

    const result = await importFile("backup.zip", IMPORT_EVERYTHING, () => {});

    expect(importBackupCollections).toHaveBeenCalledWith(COLLECTIONS);
    expect(refreshAfterRestore).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: "done",
      counts: { subscriptions: 1, playlists: 1, history: 2, likes: 1, settings: 0, neuro: true },
    });
  });

  it("restores the running profile's part of an Android master backup", async () => {
    const backup = { manifest: { format: "flow-master", defaultId: "p0" }, settings: {}, collections: {} };
    readBackupFile.mockResolvedValue({ type: "backup", data: backup });
    restoreMasterProfiles.mockResolvedValue({ running: { settings: {}, collections: COLLECTIONS }, restoredElsewhere: 1 });

    const result = await importFile("master.zip", IMPORT_EVERYTHING, () => {});

    expect(restoreMasterProfiles).toHaveBeenCalledWith(backup);
    expect(importBackupCollections).toHaveBeenCalledWith(COLLECTIONS);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(result.type === "done" && result.counts.history).toBe(2);
  });

  it("leaves out what the selection turns off", async () => {
    readBackupFile.mockResolvedValue({ type: "backup", data: { schemaVersion: 2, settings: {}, collections: COLLECTIONS } });
    const onlySubscriptions = {
      settings: false,
      subscriptions: true,
      playlists: false,
      history: false,
      likes: false,
      notes: false,
      neuro: false,
    };

    await importFile("backup.zip", onlySubscriptions, () => {});

    expect(importBackupCollections).toHaveBeenCalledWith({ subscription_channels: COLLECTIONS.subscription_channels });
  });

  it("hands another app's export to that app's import", async () => {
    readBackupFile.mockResolvedValue({ type: "external", kind: "TAKEOUT" });
    runOtherAppImport.mockResolvedValue({
      type: "done",
      report: { subscriptions: 3, history: 4, playlists: 1, playlistVideos: 2, musicPlaylists: 0, musicLibrary: 0, likes: 5, adsRemoved: 0 },
    });

    const result = await importFile("takeout.zip", IMPORT_EVERYTHING, () => {});

    expect(runOtherAppImport).toHaveBeenCalledWith("TAKEOUT", ["takeout.zip"]);
    expect(result).toEqual({
      type: "done",
      counts: { subscriptions: 3, playlists: 1, history: 4, likes: 5, settings: 0, neuro: false },
    });
  });

  it("explains a file it can't read", async () => {
    readBackupFile.mockResolvedValue({ type: "unreadable", reason: "no_backup" });

    await expect(importFile("other.zip", IMPORT_EVERYTHING, () => {})).rejects.toThrow("This archive doesn't hold a Flow backup.");
  });

  it("stops without importing when an old master backup is declined", async () => {
    profilesView = { activeId: "a", profiles: [{ id: "a", name: "A", isDefault: true }, { id: "b", name: "B" }] };
    confirmAction.mockResolvedValue(false);
    readBackupFile.mockResolvedValue({ type: "backup", data: { schemaVersion: 2, scope: "MASTER", settings: {}, collections: COLLECTIONS } });

    const result = await importFile("old.json", IMPORT_EVERYTHING, () => {});

    expect(result).toEqual({ type: "cancelled" });
    expect(importBackupCollections).not.toHaveBeenCalled();
  });

  it("reports its stages in order", async () => {
    readBackupFile.mockResolvedValue({ type: "backup", data: { schemaVersion: 2, settings: {}, collections: COLLECTIONS } });
    const stages: string[] = [];

    await importFile("backup.zip", IMPORT_EVERYTHING, ({ stage }) => {
      if (stages[stages.length - 1] !== stage) stages.push(stage);
    });

    expect(stages).toEqual(["reading", "parsing", "saving"]);
  });
});
