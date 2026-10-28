import { invokeBackend } from "../api/errors";
import { validateSettingsBackup, type BackupCollections, type MasterBackup, type ProfileBackupSlice } from "./backup";

interface RestoreTarget {
  backupId: string;
  localId: string;
  running: boolean;
}

/** A master backup from a build with profiles (it carries Android's manifest). */
export function isProfilesMaster(value: unknown): value is MasterBackup {
  const manifest = (value as { manifest?: { format?: unknown } } | null)?.manifest;
  return manifest?.format === "flow-master";
}

/**
 * Adds the backup's profiles and restores every one that isn't running straight into its own
 * database. Returns the running profile's part, which the normal import restores live.
 */
export async function restoreMasterProfiles(
  backup: MasterBackup,
): Promise<{ running: ProfileBackupSlice | null; restoredElsewhere: number }> {
  const targets = await invokeBackend<RestoreTarget[]>("profiles_restore_master", {
    manifest: backup.manifest,
    avatars: backup.profile_avatars ?? {},
  });
  let running: ProfileBackupSlice | null = null;
  let restoredElsewhere = 0;
  for (const target of targets) {
    const slice =
      target.backupId === backup.manifest.defaultId
        ? { settings: backup.settings, collections: backup.collections ?? ({} as BackupCollections) }
        : backup.profiles?.[target.backupId];
    if (!slice) continue;
    if (target.running) {
      running = slice;
      continue;
    }
    const settings = validateSettingsBackup({ schemaVersion: 2, settings: slice.settings })?.settings ?? {};
    await invokeBackend("import_profile_backup", {
      id: target.localId,
      payload: { collections: slice.collections },
      settings,
    });
    restoredElsewhere++;
  }
  return { running, restoredElsewhere };
}
