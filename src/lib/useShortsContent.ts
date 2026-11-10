import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

/** Whether Shorts show at all: every Shorts surface answers to this one switch. */
export function useShortsEnabled(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.SHORTS_CONTENT_ENABLED] !== "false");
}

type SettingValues = Partial<Record<string, string>>;

const playsInNormalPlayer = (values: SettingValues) =>
  values[SETTINGS.SHORTS_CONTENT_ENABLED] === "false" || values[SETTINGS.DISABLE_SHORTS_PLAYER] === "true";

/** Whether a Short opens in the normal player: by the viewer's choice, or because Shorts are hidden. */
export function useShortsPlayerDisabled(): boolean {
  return useAppSettingsStore((state) => playsInNormalPlayer(state.values));
}

/** The same answer for code outside a render. */
export function shortsPlayerDisabledNow(): boolean {
  return playsInNormalPlayer(useAppSettingsStore.getState().values);
}

/** A list as it shows with the Show Shorts switch where it is. */
export function videosWithShorts<T extends { isShort?: boolean }>(videos: T[], shortsEnabled: boolean): T[] {
  return shortsEnabled ? videos : videos.filter((video) => !video.isShort);
}

/** A channel's tabs without its Shorts tab, unless Shorts show or the viewer kept that tab. */
export function channelTabsFor<T extends { kind: string }>(tabs: T[], shortsEnabled: boolean, keepTab: boolean): T[] {
  return shortsEnabled || keepTab ? tabs : tabs.filter((tab) => tab.kind !== "shorts");
}

export function useChannelShortsTabKept(): boolean {
  return useAppSettingsStore((state) => state.values[SETTINGS.CHANNEL_SHORTS_TAB_WHEN_HIDDEN] === "true");
}
