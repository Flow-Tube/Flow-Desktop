import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { usePlayerStore } from "../store/usePlayerStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useSettingsStore, type DiscordRpcMode } from "../store/useSettingsStore";
import {
  clearDiscordPresence,
  setDiscordPresence,
  type DiscordPresencePayload,
} from "./api/discord";

export type Surface = "video" | "music";

interface SurfaceState {
  present: boolean;
  playing: boolean;
}

// Which surface to show: mode gates eligibility, a playing surface beats a paused one,
// and music wins over video when both qualify. Null = show nothing.
export function chooseDiscordSurface(
  mode: DiscordRpcMode,
  music: SurfaceState,
  video: SurfaceState,
): Surface | null {
  if (mode === "off") return null;
  const candidates: { surface: Surface; playing: boolean }[] = [];
  if ((mode === "music" || mode === "musicAndVideos") && music.present) {
    candidates.push({ surface: "music", playing: music.playing });
  }
  if ((mode === "videos" || mode === "musicAndVideos") && video.present) {
    candidates.push({ surface: "video", playing: video.playing });
  }
  const playing = candidates.filter((c) => c.playing);
  const pool = playing.length > 0 ? playing : candidates;
  return (
    (pool.find((c) => c.surface === "music") ?? pool.find((c) => c.surface === "video"))?.surface ??
    null
  );
}

// A seek shows up as elapsed diverging from where playback should be by now.
const SEEK_THRESHOLD_SECONDS = 3;
// Backstop tick so a seek (which changes no subscribed value) still reflects.
const RECONCILE_INTERVAL_MS = 3000;

// Drives Discord Rich Presence from the player stores. Video and music can play at
// once; `discordMode` gates which are eligible, playing beats paused, music wins over
// video. Pushes only on a real change — Discord animates the bar from the timestamps.
export function useDiscordPresence(): void {
  const { t } = useTranslation("settings");

  // Subscribe to identity signals for prompt reconciles; read the moving position via
  // getState() to avoid re-renders.
  const discordMode = useSettingsStore((s) => s.discordMode);
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const videoPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const musicPlaying = useMusicPlayerStore((s) => s.isPlaying);

  const lastSent = useRef<{ key: string; sentAt: number; elapsed: number } | null>(null);
  const liveWatchStart = useRef<{ id: string; at: number } | null>(null);

  const reconcile = useCallback(() => {
    const mode = useSettingsStore.getState().discordMode;
    const v = usePlayerStore.getState();
    const m = useMusicPlayerStore.getState();
    const now = Date.now();

    const chosen = chooseDiscordSurface(
      mode,
      { present: !!m.currentTrack, playing: m.isPlaying },
      { present: !!v.currentVideo, playing: v.isPlaying },
    );

    if (!chosen) {
      if (lastSent.current) {
        lastSent.current = null;
        void clearDiscordPresence();
      }
      return;
    }

    let payload: DiscordPresencePayload;
    let elapsed = 0;
    if (chosen === "music" && m.currentTrack) {
      const track = m.currentTrack;
      const trackVideoId = track.videoId ?? track.id;
      elapsed = m.progress;
      payload = {
        kind: "music",
        title: track.title,
        subtitle: track.artists.map((a) => a.name).filter(Boolean).join(", ") || undefined,
        album: track.album?.name || undefined,
        artworkUrl: track.thumbnail || undefined,
        elapsedSeconds: elapsed,
        durationSeconds: m.duration || track.duration || undefined,
        isPaused: !m.isPlaying,
        url: trackVideoId ? `https://music.youtube.com/watch?v=${trackVideoId}` : undefined,
        buttonLabel: t("discord.buttonListen"),
      };
    } else if (chosen === "video" && v.currentVideo) {
      const video = v.currentVideo;
      const isLive = Boolean(video.isLive);
      // A live stream's currentTime is a DVR-window position, not watch time, so
      // count up from when this stream started playing here instead.
      if (isLive) {
        if (liveWatchStart.current?.id !== video.id) {
          liveWatchStart.current = { id: video.id, at: now };
        }
        elapsed = (now - liveWatchStart.current.at) / 1000;
      } else {
        elapsed = v.currentTime;
      }
      payload = {
        kind: isLive ? "live" : "video",
        title: video.title,
        subtitle: video.channelName || undefined,
        artworkUrl: video.thumbnailUrl || undefined,
        elapsedSeconds: elapsed,
        durationSeconds: isLive ? undefined : video.durationSeconds ?? v.duration ?? undefined,
        isPaused: !v.isPlaying,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        buttonLabel: t("discord.buttonWatch"),
      };
    } else {
      return;
    }

    // Send only on a real change: item/surface, pause, seek, or late duration.
    const key = `${payload.kind}|${payload.url ?? payload.title ?? ""}|${payload.isPaused ? "p" : "x"}|${payload.durationSeconds ? "d" : "n"}`;
    const prev = lastSent.current;
    if (prev && prev.key === key) {
      if (payload.isPaused) return;
      const expected = prev.elapsed + (now - prev.sentAt) / 1000;
      if (Math.abs(elapsed - expected) <= SEEK_THRESHOLD_SECONDS) return;
    }

    lastSent.current = { key, sentAt: now, elapsed };
    void setDiscordPresence(payload);
  }, [t]);

  // Reconcile promptly on any identity/pause/mode change.
  useEffect(() => {
    reconcile();
  }, [reconcile, discordMode, currentVideo, videoPlaying, currentTrack, musicPlaying]);

  // Backstop for seeks, which don't change any subscribed value.
  useEffect(() => {
    const id = window.setInterval(reconcile, RECONCILE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reconcile]);
}
