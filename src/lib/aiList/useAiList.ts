import { useMemo } from "react";
import { aiListSourceSettings, type AiVerdict } from "../api/aiList";
import { SETTINGS } from "../settings/schema";
import { getSettingValue, setSettingValue, useAppSettingsStore } from "../../store/useAppSettingsStore";
import {
  loadAiList,
  parseAllowedAiChannels,
  readAiListSwitches,
  refreshAiList,
  useAiListStore,
  type AllowedAiChannel,
} from "../../store/useAiListStore";
import type { AiListMatcher } from "./matcher";

export { checkAiReport, submitAiReport } from "../api/aiList";
export type { AiListStatus, AiReportCheck, AiReportResult, AiVerdict } from "../api/aiList";
export type { AllowedAiChannel } from "../../store/useAiListStore";
export { getAiListMatcher, refreshAiList } from "../../store/useAiListStore";

/** Flow's own list host, for the Settings source row. */
export const AI_LIST_DEFAULT_SOURCE_HOST = "ailist.flow-tube.org";
/** AiSList's homepage, which its CC BY-NC licence asks to credit. */
export const AISLIST_HOMEPAGE = "https://aisloplist.com";
/** The AI music list's two sources, credited as their licences ask. */
export const SOUL_OVER_AI_HOMEPAGE = "https://souloverai.com";
export const SPOTIFY_AI_BLOCKER_REPO = "https://github.com/CennoxX/spotify-ai-blocker";

/** The matcher every card and feed filter reads; re-renders only when it changes. */
export function useAiListMatcher(): AiListMatcher {
  return useAiListStore((state) => state.matcher);
}

/** A predicate for channels the filter hides, or undefined while it hides nothing. */
export function useAiHidesChannel(): ((channelId: string, handle?: string | null) => boolean) | undefined {
  const matcher = useAiListMatcher();
  return useMemo(
    () => (matcher.isActive ? (channelId, handle) => matcher.verdict(channelId, handle) === "block" : undefined),
    [matcher],
  );
}

/** Which list a channel is on under the viewer's switches; `"none"` while the filter is off. */
export function useAiChannelVerdict(channelId: string | null | undefined, handle?: string | null): AiVerdict {
  const matcher = useAiListMatcher();
  return useMemo(() => matcher.verdict(channelId, handle), [matcher, channelId, handle]);
}

/** True when a card should carry the "Suspected AI" label. */
export function useAiChannelLabel(channelId: string | null | undefined, handle?: string | null): boolean {
  return useAiChannelVerdict(channelId, handle) === "warn";
}

/** A predicate for music items the filter hides, by the channel ids they credit; undefined while it hides nothing. */
export function useAiHidesMusic(): ((ids: ReadonlyArray<string | null | undefined>) => boolean) | undefined {
  const matcher = useAiListMatcher();
  return useMemo(
    () => (matcher.isMusicActive ? (ids) => matcher.musicVerdict(ids) === "block" : undefined),
    [matcher],
  );
}

/** Which list a music item is on, by the channel ids it credits; `"none"` while the filter is off. */
export function useAiMusicVerdict(ids: ReadonlyArray<string | null | undefined>): AiVerdict {
  const matcher = useAiListMatcher();
  const key = ids.join("|");
  // The ids arrive as a fresh array each render; their joined value is what matters.
  return useMemo(() => matcher.musicVerdict(ids), [matcher, key]);
}

/** The switches: hide listed channels, label suspected ones, hide AI music. All off by default. */
export function useAiListSwitches() {
  const blockEnabled = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_BLOCK_ENABLED] === "true");
  const warnEnabled = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_WARN_ENABLED] === "true");
  const musicEnabled = useAppSettingsStore((state) => state.values[SETTINGS.AI_MUSIC_BLOCK_ENABLED] === "true");
  return { blockEnabled, warnEnabled, musicEnabled, isOn: blockEnabled || warnEnabled || musicEnabled };
}

/** The Settings status row: null status while off or before the first download. */
export function useAiListStatus() {
  const status = useAiListStore((state) => state.status);
  const refreshing = useAiListStore((state) => state.refreshing);
  return { status, refreshing };
}

export function useAllowedAiChannels(): AllowedAiChannel[] {
  const raw = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_ALLOWED]);
  return useMemo(() => parseAllowedAiChannels(raw), [raw]);
}

/** The list source as stored: null URL means Flow's own. */
export function useAiListSource() {
  const url = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_SOURCE_URL]) ?? "";
  const key = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_SOURCE_KEY]) ?? "";
  return useMemo(() => {
    let host = AI_LIST_DEFAULT_SOURCE_HOST;
    try {
      if (url) host = new URL(url).host;
    } catch {
      host = url;
    }
    return { url: url || null, key: key || null, isDefault: !url, host };
  }, [url, key]);
}

/** The submitter name and whether the video menu offers a report. */
export function useAiReportSettings() {
  const enabled = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_REPORT_ENABLED] === "true");
  const name = useAppSettingsStore((state) => state.values[SETTINGS.AI_LIST_REPORT_NAME]) ?? "";
  return { enabled, name };
}

type AiListSwitchKey =
  | typeof SETTINGS.AI_LIST_BLOCK_ENABLED
  | typeof SETTINGS.AI_LIST_WARN_ENABLED
  | typeof SETTINGS.AI_MUSIC_BLOCK_ENABLED;

/** Which lists the switches ask for: the channel list for either channel switch, the music list for its own. */
function listsWanted(): { channels: boolean; music: boolean } {
  const { blockEnabled, warnEnabled, musicEnabled } = readAiListSwitches();
  return { channels: blockEnabled || warnEnabled, music: musicEnabled };
}

async function setSwitch(key: AiListSwitchKey, enabled: boolean) {
  const before = listsWanted();
  if (!(await setSettingValue(key, String(enabled)))) return false;
  const after = listsWanted();
  // A list newly asked for downloads at once, as Android schedules an immediate run.
  if ((after.channels && !before.channels) || (after.music && !before.music)) void refreshAiList();
  return true;
}

export function setAiListBlockEnabled(enabled: boolean): Promise<boolean> {
  return setSwitch(SETTINGS.AI_LIST_BLOCK_ENABLED, enabled);
}

export function setAiListWarnEnabled(enabled: boolean): Promise<boolean> {
  return setSwitch(SETTINGS.AI_LIST_WARN_ENABLED, enabled);
}

export function setAiMusicBlockEnabled(enabled: boolean): Promise<boolean> {
  return setSwitch(SETTINGS.AI_MUSIC_BLOCK_ENABLED, enabled);
}

/** Shows this channel's videos again despite the list; `disallowAiChannel` undoes it. */
export function allowAiChannel(channel: AllowedAiChannel): Promise<boolean> {
  const others = parseAllowedAiChannels(getSettingValue(SETTINGS.AI_LIST_ALLOWED)).filter((entry) => entry.id !== channel.id);
  const entry: AllowedAiChannel = { id: channel.id, name: channel.name, ...(channel.handle ? { handle: channel.handle } : {}) };
  return setSettingValue(SETTINGS.AI_LIST_ALLOWED, JSON.stringify([...others, entry]));
}

export function disallowAiChannel(channelId: string): Promise<boolean> {
  const remaining = parseAllowedAiChannels(getSettingValue(SETTINGS.AI_LIST_ALLOWED)).filter((entry) => entry.id !== channelId);
  return setSettingValue(SETTINGS.AI_LIST_ALLOWED, JSON.stringify(remaining));
}

/**
 * Saves a custom source, or goes back to Flow's own when `url` is blank. Resolves false, saving
 * nothing, when the URL is not https or the key is not an Ed25519 public key. A new source starts
 * empty and downloads at once; the old list never filters for it.
 */
export async function saveAiListSource(url: string, key: string): Promise<boolean> {
  const settings = await aiListSourceSettings(url, key);
  if (!settings) return false;
  const savedUrl = await setSettingValue(SETTINGS.AI_LIST_SOURCE_URL, settings.url ?? "");
  const savedKey = await setSettingValue(SETTINGS.AI_LIST_SOURCE_KEY, settings.key ?? "");
  if (!savedUrl || !savedKey) return false;
  await refreshAiList();
  await loadAiList();
  return true;
}

export function setAiReportEnabled(enabled: boolean): Promise<boolean> {
  return setSettingValue(SETTINGS.AI_LIST_REPORT_ENABLED, String(enabled));
}

export function setAiReportName(name: string): Promise<boolean> {
  return setSettingValue(SETTINGS.AI_LIST_REPORT_NAME, name.trim());
}
