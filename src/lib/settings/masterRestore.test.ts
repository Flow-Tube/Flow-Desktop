import { describe, expect, it, vi } from "vitest";

const calls: { command: string; args: Record<string, unknown> }[] = [];
vi.mock("../api/errors", () => ({
  invokeBackend: vi.fn(async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "profiles_restore_master") {
      return [
        { backupId: "backup-default", localId: "local-default", running: false },
        { backupId: "study", localId: "study", running: true },
        { backupId: "gaming", localId: "gaming", running: false },
      ];
    }
    return { collections: [] };
  }),
}));

import type { MasterBackup } from "./backup";
import { isProfilesMaster, restoreMasterProfiles } from "./masterRestore";

const backup = {
  schemaVersion: 2,
  scope: "MASTER",
  settings: { theme_id: "ocean" },
  collections: { watch_history: [{ v: "default" }] },
  manifest: { format: "flow-master", version: 1, defaultId: "backup-default", profiles: [], included: [] },
  profiles: {
    study: { settings: {}, collections: { watch_history: [{ v: "study" }] } },
    gaming: { settings: { theme_id: "neon" }, collections: {} },
  },
  profile_avatars: {},
} as unknown as MasterBackup;

describe("restoreMasterProfiles", () => {
  it("recognises only a master with a manifest", () => {
    expect(isProfilesMaster(backup)).toBe(true);
    expect(isProfilesMaster({ scope: "MASTER", settings: {} })).toBe(false);
  });

  it("restores the closed profiles directly and hands back the running one", async () => {
    const { running, restoredElsewhere } = await restoreMasterProfiles(backup);
    expect(running?.collections).toEqual({ watch_history: [{ v: "study" }] });
    expect(restoredElsewhere).toBe(2);
    const imports = calls.filter((call) => call.command === "import_profile_backup");
    expect(imports.map((call) => call.args.id)).toEqual(["local-default", "gaming"]);
    expect(imports[0]?.args.payload).toEqual({ collections: { watch_history: [{ v: "default" }] } });
    expect(imports[1]?.args.settings).toEqual({ theme_id: "neon" });
  });
});
