import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import type { SongItem } from "../types/music";
import {
  MUSIC_TRAY_ACTION_EVENT,
  hideMusicTray,
  musicTraySupported,
  updateMusicTray,
  type MusicTrayAction,
} from "./api/tray";
import { isTauriEnv } from "./api/env";
import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { useBoolPref } from "./usePreference";

/** The tray's first line: the song and its artists, or a placeholder when nothing is loaded. */
export function trayNowPlaying(track: SongItem | null, nothingPlaying: string): string {
  if (!track) return nothingPlaying;
  const artists = track.artists.map((artist) => artist.name).filter(Boolean).join(", ");
  return artists ? `${track.title} · ${artists}` : track.title;
}

export function runTrayAction(action: MusicTrayAction): void {
  const player = useMusicPlayerStore.getState();
  if (!player.currentTrack) return;
  if (action === "toggle") player.togglePlay();
  else if (action === "next") player.next();
  else if (action === "previous") player.previous();
}

/** Null until the backend answers; false on Linux without an AppIndicator library. */
export function useMusicTraySupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let disposed = false;
    void musicTraySupported().then((value) => {
      if (!disposed) setSupported(value);
    });
    return () => {
      disposed = true;
    };
  }, []);
  return supported;
}

// Mirrors the music player into the system tray and plays back the tray's clicks.
export function useMusicTray(): void {
  const [enabledPref] = useBoolPref(SETTINGS.MUSIC_TRAY_ENABLED);
  // Until the saved value arrives the default shows, which would build a tray only to remove it.
  const loaded = useAppSettingsStore((s) => s.loaded);
  const enabled = loaded && enabledPref;
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);

  useEffect(() => {
    if (!loaded) return;
    if (!enabled) {
      void hideMusicTray();
      return;
    }
    void updateMusicTray({
      nowPlaying: trayNowPlaying(currentTrack, getString("music_tray_nothing_playing")),
      hasTrack: !!currentTrack,
      playing: isPlaying,
      labels: {
        play: getString("music_play"),
        pause: getString("music_pause"),
        previous: getString("music_previous"),
        next: getString("music_next"),
        show: getString("music_tray_show"),
      },
    });
  }, [loaded, enabled, currentTrack, isPlaying]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void isTauriEnv().then(async (inTauri) => {
      if (!inTauri || disposed) return;
      const stop = await listen<MusicTrayAction>(MUSIC_TRAY_ACTION_EVENT, (event) => runTrayAction(event.payload));
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("Failed to listen for tray actions", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);
}
