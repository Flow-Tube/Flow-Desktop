import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useTabsStore } from "../store/useTabsStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";
import {
  TRAY_CONTINUE_WATCHING_EVENT,
  hideMusicTray,
  musicTraySupported,
  updateMusicTray,
} from "./api/tray";
import { isTauriEnv } from "./api/env";
import { IS_MAIN_WINDOW } from "./appWindow";
import { getString } from "./i18n/index";
import { SETTINGS } from "./settings/schema";
import { useContinueWatching } from "./useContinueWatching";
import { chooseDiscordSurface } from "./useDiscordPresence";
import { useBoolPref } from "./usePreference";

/** The tray's first line: what plays, with its artists or channel, or a placeholder. */
export function trayNowPlaying(track: SongItem | null, video: VideoSummary | null, nothingPlaying: string): string {
  if (track) {
    const artists = track.artists.map((artist) => artist.name).filter(Boolean).join(", ");
    return artists ? `${track.title} · ${artists}` : track.title;
  }
  if (video) return video.channelName ? `${video.title} · ${video.channelName}` : video.title;
  return nothingPlaying;
}

/** The newest video to resume, unless it is the one in the player already. */
export function videoToResume(videos: VideoSummary[], current: VideoSummary | null): VideoSummary | null {
  return videos.find((video) => video.id !== current?.id) ?? null;
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

// Reports what this window plays to the system tray. The main window also says whether there is
// a tray at all and offers Continue watching; other windows only report their video.
export function useMusicTray(): void {
  const [enabledPref] = useBoolPref(SETTINGS.MUSIC_TRAY_ENABLED);
  const [continueWatchingPref] = useBoolPref(SETTINGS.CONTINUE_WATCHING_ENABLED);
  // Until the saved value arrives the default shows, which would build a tray only to remove it.
  const loaded = useAppSettingsStore((s) => s.loaded);
  const enabled = loaded && enabledPref;
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const musicPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const currentVideo = usePlayerStore((s) => s.currentVideo);
  const videoPlaying = usePlayerStore((s) => s.isPlaying);
  const { videos } = useContinueWatching(IS_MAIN_WINDOW && enabled && continueWatchingPref);
  const resume = videoToResume(videos, currentVideo);
  const resumeRef = useRef(resume);
  resumeRef.current = resume;

  const surface = chooseDiscordSurface(
    "musicAndVideos",
    { present: !!currentTrack, playing: musicPlaying },
    { present: !!currentVideo, playing: videoPlaying },
  );
  const shownTrack = surface === "music" ? currentTrack : null;
  const shownVideo = surface === "video" ? currentVideo : null;
  const playing = surface === "music" ? musicPlaying : surface === "video" && videoPlaying;
  const resumeTitle = resume?.title ?? null;

  useEffect(() => {
    if (IS_MAIN_WINDOW) {
      if (!loaded) return;
      if (!enabled) {
        void hideMusicTray();
        return;
      }
    }
    void updateMusicTray({
      nowPlaying: trayNowPlaying(shownTrack, shownVideo, getString("music_tray_nothing_playing")),
      hasTrack: surface !== null,
      playing,
      continueWatching: resumeTitle ? getString("tray_continue_watching_title", resumeTitle) : null,
      labels: {
        play: getString("music_play"),
        pause: getString("music_pause"),
        previous: getString("music_previous"),
        next: getString("music_next"),
        show: getString("music_tray_show"),
        continueWatching: getString("tray_continue_watching"),
      },
    });
  }, [loaded, enabled, shownTrack, shownVideo, surface, playing, resumeTitle]);

  useEffect(() => {
    if (!IS_MAIN_WINDOW || !enabled) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void isTauriEnv().then(async (inTauri) => {
      if (!inTauri || disposed) return;
      const stop = await listen(TRAY_CONTINUE_WATCHING_EVENT, () => {
        const video = resumeRef.current;
        if (video) useTabsStore.getState().push(`/watch/${video.id}`);
      });
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("Failed to listen for the tray", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);
}
