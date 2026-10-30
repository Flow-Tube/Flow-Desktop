import { useEffect } from "react";

import { isTauriEnv } from "../api/env";
import { publishNow, type Now } from "../api/live";
import { IS_MAIN_WINDOW } from "../appWindow";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { changed, nowOf, type Playing } from "./now";

/** While playing, `now` goes out at least this often, so other devices keep the position right. */
const REPEAT_MS = 30_000;

/** The music player when it has a track and the video player isn't playing; otherwise the video. */
function playing(): Playing | null {
  const music = useMusicPlayerStore.getState();
  const video = usePlayerStore.getState();
  if (music.currentTrack && (music.isPlaying || !video.isPlaying)) {
    const track = music.currentTrack;
    return {
      video: track.videoId ?? track.id,
      title: track.title,
      by: track.artists.map((artist) => artist.name).join(", "),
      music: true,
      position: music.progress,
      duration: music.duration,
      playing: music.isPlaying,
      volume: music.isMuted ? 0 : music.volume,
      queue: music.queue.map((song) => song.videoId ?? song.id),
      index: music.currentIndex,
    };
  }
  if (!video.currentVideo) return null;
  return {
    video: video.currentVideo.id,
    title: video.currentVideo.title,
    by: video.currentVideo.channelName,
    music: false,
    position: video.currentTime,
    duration: video.duration,
    playing: video.isPlaying,
    volume: video.muted ? 0 : video.volume,
    queue: video.queue.map((item) => item.id),
    index: video.currentIndex,
  };
}

/**
 * Tells the group's other devices what this one plays (spec/live.md, Playing on another device):
 * on every change, and every 30 seconds while playing. Nothing goes out outside a group.
 */
export function useLiveNow(): void {
  useEffect(() => {
    const stops: Array<() => void> = [];
    let ended = false;
    void isTauriEnv().then((tauri) => {
      if (!tauri || !IS_MAIN_WINDOW || ended) return;
      let sent: Now | null = null;
      let sentAtMs = 0;
      const publish = (repeat: boolean) => {
        const next = nowOf(playing());
        const at = Date.now();
        if ((sent?.video ?? null) === null && next.video === null) return;
        if (!repeat && !changed(sent, sentAtMs, next, at)) return;
        sent = next;
        sentAtMs = at;
        publishNow(next).catch(() => undefined);
      };
      stops.push(usePlayerStore.subscribe(() => publish(false)), useMusicPlayerStore.subscribe(() => publish(false)));
      const timer = setInterval(() => sent?.state === "playing" && publish(true), REPEAT_MS);
      stops.push(() => clearInterval(timer));
    });
    return () => {
      ended = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
