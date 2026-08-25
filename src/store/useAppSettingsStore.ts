import { create } from "zustand";
import { getSetting, setSetting as persistSetting } from "../lib/api/db";
import { getString } from "../lib/i18n/index";
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingKey,
} from "../lib/settings/schema";
import {
  getSettingDefinition,
  isSettingKey,
  normalizeSettingValue,
  validateSettingValue,
} from "../lib/settings/values";
import { useUiStore } from "./useUiStore";

type SettingsValues = Partial<Record<SettingKey, string>>;

interface AppSettingsState {
  values: SettingsValues;
  loaded: boolean;
  loading: boolean;
  lastError: string | null;
  loadSettings: () => Promise<void>;
  /** Adopts values another window already read and validated, so a window that
   * has to start playing immediately does not wait on one SQLite round trip per
   * setting first. */
  hydrateSettings: (values: SettingsValues) => void;
  setSettingValue: (key: SettingKey, value: string) => Promise<boolean>;
}

const defaultValues = (): SettingsValues =>
  Object.fromEntries(
    SETTING_DEFINITIONS.map((definition) => [definition.key, definition.defaultValue]),
  ) as SettingsValues;

const showSaveFailedToast = () => {
  useUiStore.getState().showToast({
    title: getString("settings_save_failed_title"),
    message: getString("settings_save_failed_message"),
    variant: "error",
  });
};

const showInvalidValueToast = () => {
  useUiStore.getState().showToast({
    title: getString("settings_invalid_value_title"),
    message: getString("settings_invalid_value_message"),
    variant: "error",
  });
};

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  values: defaultValues(),
  loaded: false,
  loading: false,
  lastError: null,

  loadSettings: async () => {
    if (get().loading) return;

    set({ loading: true, lastError: null });
    try {
      const entries = await Promise.all(
        SETTING_DEFINITIONS.map(async (definition) => {
          const stored = await getSetting(definition.key);
          const parsed = normalizeSettingValue(definition, stored);
          if (parsed.usedFallback) {
            console.warn("Invalid persisted setting; using default", {
              key: definition.key,
              reason: parsed.reason,
              stored,
            });
          }
          return [definition.key, parsed.value] as const;
        }),
      );

      set({
        values: Object.fromEntries(entries) as SettingsValues,
        loaded: true,
        loading: false,
        lastError: null,
      });
    } catch (error) {
      console.warn("Failed to load app settings", error);
      set({
        values: defaultValues(),
        loaded: true,
        loading: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  hydrateSettings: (values) => {
    set({ values: { ...defaultValues(), ...values }, loaded: true, lastError: null });
  },

  setSettingValue: async (key, value) => {
    const definition = getSettingDefinition(key);
    const parsed = validateSettingValue(definition, value);
    if (parsed.usedFallback) {
      console.warn("Rejected invalid setting value", {
        key,
        value,
        reason: parsed.reason,
      });
      showInvalidValueToast();
      return false;
    }

    const previousValue = getSettingValue(key);
    const nextValue = parsed.value;

    set((state) => ({
      values: { ...state.values, [key]: nextValue },
      lastError: null,
    }));

    try {
      await persistSetting(key, nextValue);
      return true;
    } catch (error) {
      console.warn("Failed to persist setting", { key, error });
      set((state) => ({
        values: { ...state.values, [key]: previousValue },
        lastError: error instanceof Error ? error.message : String(error),
      }));
      showSaveFailedToast();
      return false;
    }
  },
}));

export function getSettingValue(key: SettingKey): string {
  const definition = getSettingDefinition(key);
  return useAppSettingsStore.getState().values[key] ?? definition.defaultValue;
}

export async function setSettingValue(key: SettingKey, value: string): Promise<boolean> {
  return useAppSettingsStore.getState().setSettingValue(key, value);
}

export function getSettingDefinitionIfKnown(key: string): SettingDefinition | null {
  return isSettingKey(key) ? getSettingDefinition(key) : null;
}
