import { useEffect } from "react";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useTabsStore } from "../../store/useTabsStore";
import { SETTINGS } from "../settings/schema";

/**
 * Turning tabs off leaves the window with the tab you are on. The video in the
 * player keeps playing either way. Waits for the stored settings, so the
 * default (off) never collapses tabs that were just restored.
 */
export function useSingleTabWhenOff(): void {
  const tabsOff = useAppSettingsStore((state) => state.loaded && state.values[SETTINGS.TABS_ENABLED] !== "true");
  useEffect(() => {
    if (!tabsOff) return;
    const { tabs, activeId, keepOnlyTab } = useTabsStore.getState();
    if (tabs.length > 1) keepOnlyTab(activeId);
  }, [tabsOff]);
}
