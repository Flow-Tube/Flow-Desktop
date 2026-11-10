import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore, type PlaybackRate } from "../store/usePlayerStore";
import { setSettingValue, useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";
import { normalizePlaybackRate } from "./settings/playerRuntime";
import { isMusicVideo } from "./utils";

export type ChannelSpeeds = Record<string, number>;

/** A damaged value reads as no saved speeds rather than failing playback. */
export function parseChannelSpeeds(raw: string | undefined): ChannelSpeeds {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
}

/** Categories come from an English-locale request, so the name is stable. */
export function isMusicPlayback(video: Parameters<typeof isMusicVideo>[0], category: string | null | undefined): boolean {
  return isMusicVideo(video) || category?.toLowerCase() === "music";
}

/**
 * The speed that applies to this video only, whatever the default is. A channel's own speed comes
 * first, then music at normal speed. Null leaves the default.
 */
export function startSpeedOverride(input: {
  channelSpeed: number | null;
  isMusic: boolean;
  musicAtNormalSpeed: boolean;
}): PlaybackRate | null {
  if (input.channelSpeed !== null) return normalizePlaybackRate(input.channelSpeed);
  return input.isMusic && input.musicAtNormalSpeed ? 1 : null;
}

/**
 * Sets the speed each new source starts at. The channel and category can arrive after playback has
 * started, so a later override still applies, unless the viewer has already picked a speed. The
 * returned function records a speed picked on the player.
 */
export function usePlaybackStartSpeed(
  mediaIdentity: string,
  defaultRate: PlaybackRate,
  category: string | null | undefined,
) {
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const channelId = usePlayerStore((s) => s.currentVideo?.channelId ?? null);
  const isMusic = usePlayerStore((s) => (s.currentVideo ? isMusicPlayback(s.currentVideo, category) : false));
  const perChannel = useAppSettingsStore((s) => s.values[SETTINGS.SPEED_PER_CHANNEL] === "true");
  const musicAtNormalSpeed = useAppSettingsStore((s) => s.values[SETTINGS.MUSIC_AT_NORMAL_SPEED] === "true");
  const speedsRaw = useAppSettingsStore((s) => s.values[SETTINGS.CHANNEL_PLAYBACK_SPEEDS]);

  const channelSpeed = perChannel && channelId ? parseChannelSpeeds(speedsRaw)[channelId] ?? null : null;
  const override = startSpeedOverride({ channelSpeed, isMusic, musicAtNormalSpeed });

  const appliedRef = useRef<{ identity: string; hadOverride: boolean; picked: boolean } | null>(null);
  useEffect(() => {
    if (!mediaIdentity) return;
    const applied = appliedRef.current;
    if (applied?.identity !== mediaIdentity) {
      appliedRef.current = { identity: mediaIdentity, hadOverride: override !== null, picked: false };
      setPlaybackRate(override ?? defaultRate);
    } else if (override !== null && !applied.hadOverride && !applied.picked) {
      applied.hadOverride = true;
      setPlaybackRate(override);
    }
  }, [defaultRate, mediaIdentity, override, setPlaybackRate]);

  return useCallback(
    (rate: PlaybackRate) => {
      if (appliedRef.current) appliedRef.current.picked = true;
      if (!perChannel || !channelId) return;
      const speeds = parseChannelSpeeds(useAppSettingsStore.getState().values[SETTINGS.CHANNEL_PLAYBACK_SPEEDS]);
      void setSettingValue(SETTINGS.CHANNEL_PLAYBACK_SPEEDS, JSON.stringify({ ...speeds, [channelId]: rate }));
    },
    [channelId, perChannel],
  );
}
