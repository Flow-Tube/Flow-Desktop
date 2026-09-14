import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import { SETTINGS } from "../lib/settings/schema";
import { getSettingValue, setSettingValue, useAppSettingsStore } from "./useAppSettingsStore";

export type SponsorBlockCategory =
  | "sponsor"
  | "intro"
  | "outro"
  | "selfpromo"
  | "interaction"
  | "music_offtopic"
  | "filler"
  | "preview"
  | "exclusive_access";

export type SponsorBlockAction = "skip" | "mute" | "notify" | "ignore";

export type DiscordRpcMode = "off" | "music" | "videos" | "musicAndVideos";

const DISCORD_RPC_MODES = ["off", "music", "videos", "musicAndVideos"] as const satisfies readonly DiscordRpcMode[];

function normalizeDiscordMode(raw: string | null | undefined): DiscordRpcMode {
  return (DISCORD_RPC_MODES as readonly string[]).includes(raw ?? "") ? (raw as DiscordRpcMode) : "off";
}

export const SPONSORBLOCK_CATEGORIES = [
  "sponsor",
  "intro",
  "outro",
  "selfpromo",
  "interaction",
  "music_offtopic",
  "filler",
  "preview",
  "exclusive_access",
] as const satisfies readonly SponsorBlockCategory[];

const SPONSORBLOCK_ACTIONS = ["skip", "mute", "notify", "ignore"] as const satisfies readonly SponsorBlockAction[];
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_SERVER_URL = "https://sponsor.ajay.app";

export const DEFAULT_SB_COLORS: Record<SponsorBlockCategory, string> = {
  sponsor: "#00d400",
  intro: "#00ffff",
  outro: "#0000ff",
  selfpromo: "#ffff00",
  interaction: "#ff0000",
  music_offtopic: "#ff0584",
  filler: "#7300ff",
  preview: "#0080c0",
  exclusive_access: "#ff7f00",
};

export const DEFAULT_SB_ACTIONS: Record<SponsorBlockCategory, SponsorBlockAction> = {
  sponsor: "skip",
  intro: "skip",
  outro: "skip",
  selfpromo: "skip",
  interaction: "ignore",
  music_offtopic: "ignore",
  filler: "ignore",
  preview: "ignore",
  exclusive_access: "ignore",
};

function isSponsorBlockCategory(value: string): value is SponsorBlockCategory {
  return (SPONSORBLOCK_CATEGORIES as readonly string[]).includes(value);
}

function isSponsorBlockAction(value: string): value is SponsorBlockAction {
  return (SPONSORBLOCK_ACTIONS as readonly string[]).includes(value);
}

function normalizeServerUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_SERVER_URL;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeColors(raw: string | null | undefined): Record<SponsorBlockCategory, string> {
  if (!raw) return DEFAULT_SB_COLORS;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...DEFAULT_SB_COLORS };
    for (const [category, color] of Object.entries(parsed)) {
      if (isSponsorBlockCategory(category) && typeof color === "string" && HEX_COLOR_RE.test(color)) {
        next[category] = color.toLowerCase();
      }
    }
    return next;
  } catch {
    return DEFAULT_SB_COLORS;
  }
}

function normalizeActions(raw: string | null | undefined): Record<SponsorBlockCategory, SponsorBlockAction> {
  if (!raw) return DEFAULT_SB_ACTIONS;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...DEFAULT_SB_ACTIONS };
    for (const [category, action] of Object.entries(parsed)) {
      if (isSponsorBlockCategory(category) && typeof action === "string" && isSponsorBlockAction(action)) {
        next[category] = action;
      }
    }
    return next;
  } catch {
    return DEFAULT_SB_ACTIONS;
  }
}

function parseNonNegativeInt(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

interface SettingsState {
  sponsorBlockEnabled: boolean;
  dearrowEnabled: boolean;
  dearrowBadgeEnabled: boolean;
  rytdEnabled: boolean;
  discordMode: DiscordRpcMode;
  sbSubmitEnabled: boolean;
  sbUserId: string;
  serverUrl: string;
  sponsorBlockColors: Record<SponsorBlockCategory, string>;
  sponsorBlockActions: Record<SponsorBlockCategory, SponsorBlockAction>;
  
  // Stats
  savedMinutes: number;
  segmentsSkipped: number;

  loadSettings: () => Promise<void>;
  setSponsorBlockEnabled: (enabled: boolean) => Promise<void>;
  setDeArrowEnabled: (enabled: boolean) => Promise<void>;
  setDeArrowBadgeEnabled: (enabled: boolean) => Promise<void>;
  setRytdEnabled: (enabled: boolean) => Promise<void>;
  setDiscordMode: (mode: DiscordRpcMode) => Promise<void>;
  setSbSubmitEnabled: (enabled: boolean) => Promise<void>;
  setSbUserId: (id: string) => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  setCategoryColor: (category: SponsorBlockCategory, color: string) => Promise<void>;
  setCategoryAction: (category: SponsorBlockCategory, action: SponsorBlockAction) => Promise<void>;
  resetCategoryColors: () => Promise<void>;
  resetStats: () => Promise<void>;
  incrementStats: (category: SponsorBlockCategory, seconds: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  sponsorBlockEnabled: true,
  dearrowEnabled: true,
  dearrowBadgeEnabled: true,
  rytdEnabled: true,
  discordMode: "off",
  sbSubmitEnabled: false,
  sbUserId: "",
  serverUrl: "https://sponsor.ajay.app",
  sponsorBlockColors: DEFAULT_SB_COLORS,
  sponsorBlockActions: DEFAULT_SB_ACTIONS,
  
  savedMinutes: 0,
  segmentsSkipped: 0,

  loadSettings: async () => {
    try {
      await useAppSettingsStore.getState().loadSettings();

      const serverUrl = normalizeServerUrl(getSettingValue(SETTINGS.SPONSORBLOCK_SERVER)) ?? DEFAULT_SERVER_URL;
      const dbMinutes = getSettingValue(SETTINGS.SPONSORBLOCK_SAVED_MINUTES);
      const dbSegments = getSettingValue(SETTINGS.SPONSORBLOCK_SKIPPED_SEGMENTS);

      set({
        sponsorBlockEnabled: getSettingValue(SETTINGS.SPONSORBLOCK_ENABLED) !== "false",
        dearrowEnabled: getSettingValue(SETTINGS.DEARROW_ENABLED) !== "false",
        dearrowBadgeEnabled: getSettingValue(SETTINGS.DEARROW_BADGE_ENABLED) !== "false",
        rytdEnabled: getSettingValue(SETTINGS.RYTD_ENABLED) !== "false",
        discordMode: normalizeDiscordMode(getSettingValue(SETTINGS.DISCORD_RPC_MODE)),
        sbSubmitEnabled: getSettingValue(SETTINGS.SB_SUBMIT_ENABLED) === "true",
        sbUserId: getSettingValue(SETTINGS.SPONSORBLOCK_USER_ID),
        serverUrl,
        sponsorBlockColors: normalizeColors(getSettingValue(SETTINGS.SPONSORBLOCK_COLORS)),
        sponsorBlockActions: normalizeActions(getSettingValue(SETTINGS.SPONSORBLOCK_CATEGORIES)),
        savedMinutes: parseNonNegativeInt(dbMinutes),
        segmentsSkipped: parseNonNegativeInt(dbSegments),
      });
    } catch (e) {
      console.warn("Failed to load settings in useSettingsStore", e);
    }
  },

  setSponsorBlockEnabled: async (enabled) => {
    set({ sponsorBlockEnabled: enabled });
    await setSettingValue(SETTINGS.SPONSORBLOCK_ENABLED, String(enabled));
  },

  setDeArrowEnabled: async (enabled) => {
    set({ dearrowEnabled: enabled });
    await setSettingValue(SETTINGS.DEARROW_ENABLED, String(enabled));
  },

  setDeArrowBadgeEnabled: async (enabled) => {
    set({ dearrowBadgeEnabled: enabled });
    await setSettingValue(SETTINGS.DEARROW_BADGE_ENABLED, String(enabled));
  },

  setRytdEnabled: async (enabled) => {
    set({ rytdEnabled: enabled });
    await setSettingValue(SETTINGS.RYTD_ENABLED, String(enabled));
  },

  setDiscordMode: async (mode) => {
    set({ discordMode: mode });
    await setSettingValue(SETTINGS.DISCORD_RPC_MODE, mode);
  },

  setSbSubmitEnabled: async (enabled) => {
    set({ sbSubmitEnabled: enabled });
    await setSettingValue(SETTINGS.SB_SUBMIT_ENABLED, String(enabled));
  },

  setSbUserId: async (id) => {
    set({ sbUserId: id });
    await setSettingValue(SETTINGS.SPONSORBLOCK_USER_ID, id);
  },

  setServerUrl: async (url) => {
    const normalizedUrl = normalizeServerUrl(url);
    if (!normalizedUrl) {
      console.warn("Rejected invalid SponsorBlock API server URL", url);
      return;
    }
    set({ serverUrl: normalizedUrl });
    await setSettingValue(SETTINGS.SPONSORBLOCK_SERVER, normalizedUrl);
  },

  setCategoryColor: async (category, color) => {
    if (!isSponsorBlockCategory(category) || !HEX_COLOR_RE.test(color)) return;
    const updatedColors = { ...get().sponsorBlockColors, [category]: color };
    set({ sponsorBlockColors: updatedColors });
    await setSettingValue(SETTINGS.SPONSORBLOCK_COLORS, JSON.stringify(updatedColors));
  },

  setCategoryAction: async (category, action) => {
    if (!isSponsorBlockCategory(category) || !isSponsorBlockAction(action)) return;
    const updatedActions = { ...get().sponsorBlockActions, [category]: action };
    set({ sponsorBlockActions: updatedActions });
    await setSettingValue(SETTINGS.SPONSORBLOCK_CATEGORIES, JSON.stringify(updatedActions));
  },

  resetCategoryColors: async () => {
    set({ sponsorBlockColors: DEFAULT_SB_COLORS });
    await setSettingValue(SETTINGS.SPONSORBLOCK_COLORS, JSON.stringify(DEFAULT_SB_COLORS));
  },

  resetStats: async () => {
    set({ savedMinutes: 0, segmentsSkipped: 0 });
    await setSettingValue(SETTINGS.SPONSORBLOCK_SAVED_MINUTES, "0");
    await setSettingValue(SETTINGS.SPONSORBLOCK_SKIPPED_SEGMENTS, "0");
    await setSettingValue(SETTINGS.SPONSORBLOCK_SAVED_SECONDS, "0");
    
    for (const cat of SPONSORBLOCK_CATEGORIES) {
      await setSetting(`sb_stats_clips_${cat}`, "0");
      await setSetting(`sb_stats_seconds_${cat}`, "0");
    }
  },

  incrementStats: async (category, seconds) => {
    try {
      const currentSegments = get().segmentsSkipped;
      const nextSegments = currentSegments + 1;
      
      const currentSeconds = parseNonNegativeInt(getSettingValue(SETTINGS.SPONSORBLOCK_SAVED_SECONDS));
      const nextSeconds = currentSeconds + seconds;
      const nextMinutes = Math.round(nextSeconds / 60);

      const catClipsRaw = await getSetting(`sb_stats_clips_${category}`);
      const catClips = catClipsRaw ? parseInt(catClipsRaw, 10) : 0;
      const nextCatClips = catClips + 1;

      const catSecsRaw = await getSetting(`sb_stats_seconds_${category}`);
      const catSecs = catSecsRaw ? parseInt(catSecsRaw, 10) : 0;
      const nextCatSecs = catSecs + seconds;

      await setSettingValue(SETTINGS.SPONSORBLOCK_SKIPPED_SEGMENTS, String(nextSegments));
      await setSettingValue(SETTINGS.SPONSORBLOCK_SAVED_SECONDS, String(nextSeconds));
      await setSettingValue(SETTINGS.SPONSORBLOCK_SAVED_MINUTES, String(nextMinutes));
      await setSetting(`sb_stats_clips_${category}`, String(nextCatClips));
      await setSetting(`sb_stats_seconds_${category}`, String(nextCatSecs));

      set({
        segmentsSkipped: nextSegments,
        savedMinutes: nextMinutes
      });
    } catch (e) {
      console.warn("Failed to increment SponsorBlock stats", e);
    }
  },
}));
