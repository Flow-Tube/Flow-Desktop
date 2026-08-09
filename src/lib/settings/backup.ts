import { getSetting } from "../api/db";
import { isTauriEnv } from "../api/env";
import { invokeBackend } from "../api/errors";
import { getAppMetadata, type AppMetadata } from "../appMetadata";
import {
  SETTING_DEFINITIONS_BY_KEY,
  SETTING_EXPORT_KEYS,
  type SettingDefinition,
  type SettingKey,
} from "./schema";
import { isSettingKey, normalizeSettingValue, validateSettingValue } from "./values";

export const SETTINGS_BACKUP_SCHEMA_VERSION = 2;
/** v1 files (settings blob only) must keep importing unchanged. */
const SUPPORTED_BACKUP_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

export type SettingsBackupScope = "APP_DATA" | "BRAIN" | "MASTER";

/** The backend's full-fidelity export: sync-collection records keyed by wire key. */
export type BackupCollections = Record<string, unknown[]>;

interface BackupCollectionsExport {
  deviceId: string;
  scope: string;
  collections: BackupCollections;
}

export interface BackupCollectionImportStat {
  collection: string;
  added: number;
  updated: number;
  skipped: number;
  tombstoned: number;
}

export interface BackupImportSummary {
  collections: BackupCollectionImportStat[];
}

export interface SettingsBackup {
  schemaVersion: number;
  app: AppMetadata;
  exportedAt: string;
  scope: SettingsBackupScope;
  settings: Record<string, unknown>;
  /** Present since schemaVersion 2: the backend export in the sync wire representation. */
  collections?: BackupCollections;
  deviceId?: string;
}

export interface ValidatedSettingsBackup {
  settings: Partial<Record<SettingKey, string>>;
  invalidKeys: string[];
  skippedKeys: string[];
}

const EXPORTABLE_SETTING_KEYS = new Set<string>(SETTING_EXPORT_KEYS);

const toTypedBackupValue = (definition: SettingDefinition, value: string): unknown => {
  switch (definition.type) {
    case "boolean":
      return value === "true";
    case "number":
      return Number(value);
    case "json":
      return JSON.parse(value);
    case "string":
    default:
      return value;
  }
};

const toStoredSettingValue = (definition: SettingDefinition, value: unknown): string | null => {
  switch (definition.type) {
    case "boolean":
      if (typeof value === "boolean") return String(value);
      if (typeof value === "string") return value;
      return null;
    case "number":
      if (typeof value === "number" || typeof value === "string") return String(value);
      return null;
    case "json":
      if (typeof value === "string") return value;
      return JSON.stringify(value) ?? null;
    case "string":
    default:
      return typeof value === "string" ? value : null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function collectSettings(): Promise<Record<string, unknown>> {
  const settings: Record<string, unknown> = {};

  for (const key of SETTING_EXPORT_KEYS) {
    const definition = SETTING_DEFINITIONS_BY_KEY.get(key as SettingKey);
    if (!definition) continue;

    const stored = await getSetting(key);
    const normalized = normalizeSettingValue(definition, stored);
    settings[key] = toTypedBackupValue(definition, normalized.value);
  }

  return settings;
}

export async function buildSettingsBackup(
  scope: SettingsBackupScope = "APP_DATA",
): Promise<SettingsBackup> {
  const backup: SettingsBackup = {
    schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
    app: await getAppMetadata(),
    exportedAt: new Date().toISOString(),
    scope,
    settings: await collectSettings(),
  };

  if (await isTauriEnv()) {
    const exported = await invokeBackend<BackupCollectionsExport>("export_backup_data", {
      scope,
    });
    backup.collections = exported.collections;
    backup.deviceId = exported.deviceId;
  }

  return backup;
}

/** Restore a v2 backup's collections through the backend sync apply pipeline. */
export async function importBackupCollections(
  collections: BackupCollections,
): Promise<BackupImportSummary> {
  return invokeBackend<BackupImportSummary>("import_backup_data", {
    payload: { collections },
  });
}

/**
 * Pull the v2 `collections` payload out of a parsed backup file, tolerantly: non-array
 * entries are dropped, and `null` is returned when there is nothing importable (v1 files,
 * foreign JSON).
 */
export function extractBackupCollections(value: unknown): BackupCollections | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.collections)) return null;

  const collections: BackupCollections = {};
  for (const [key, records] of Object.entries(value.collections)) {
    if (Array.isArray(records)) collections[key] = records;
  }
  return Object.keys(collections).length > 0 ? collections : null;
}

export async function buildSettingsBackupJson(
  scope: SettingsBackupScope = "APP_DATA",
): Promise<string> {
  const backup = await buildSettingsBackup(scope);
  return JSON.stringify(backup, null, 2);
}

export function validateSettingsBackup(value: unknown): ValidatedSettingsBackup | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.schemaVersion !== "number" ||
    !SUPPORTED_BACKUP_SCHEMA_VERSIONS.has(value.schemaVersion)
  ) {
    return null;
  }
  if (!isRecord(value.settings)) return null;

  const settings: Partial<Record<SettingKey, string>> = {};
  const invalidKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const [key, importedValue] of Object.entries(value.settings)) {
    if (!isSettingKey(key) || !EXPORTABLE_SETTING_KEYS.has(key)) {
      skippedKeys.push(key);
      continue;
    }

    const definition = SETTING_DEFINITIONS_BY_KEY.get(key);
    if (!definition) {
      skippedKeys.push(key);
      continue;
    }

    const storedValue = toStoredSettingValue(definition, importedValue);
    if (storedValue === null) {
      invalidKeys.push(key);
      continue;
    }

    const parsed = validateSettingValue(definition, storedValue);
    if (parsed.usedFallback) {
      invalidKeys.push(key);
      continue;
    }

    settings[key] = parsed.value;
  }

  return {
    settings,
    invalidKeys,
    skippedKeys,
  };
}
