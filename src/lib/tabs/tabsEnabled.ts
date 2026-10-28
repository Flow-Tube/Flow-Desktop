import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { SETTINGS } from "../settings/schema";

/** Tabs are opt-in (Settings > Content); without them Flow works as a single page per window. */
export function tabsEnabled(): boolean {
  return useAppSettingsStore.getState().values[SETTINGS.TABS_ENABLED] === "true";
}

export function useTabsEnabled(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.TABS_ENABLED] === "true");
}
