import type { Cmd } from "../api/live";
import { getMusicQueue } from "../api/music";
import { seekToTime } from "../playerSeek";
import { prefetchStreamInfo } from "../streamResolution";
import { useMusicPlayerStore, warmMusicStream } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { VideoSummary } from "../../types/video";
import type { Playing } from "./now";

/** The music player when it has a track and the video player isn't playing; otherwise the video. */
export function playing(): Playing | null {
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

export function pauseHere(): void {
  useMusicPlayerStore.getState().pause();
  usePlayerStore.getState().setIsPlaying(false);
}

/** A session to start here: the same queue and place, from `pos` milliseconds. */
export interface Session {
  video: string;
  pos: number;
  music: boolean;
  queue: string[];
  index: number;
  state: "playing" | "paused";
  /** What the sender last said it plays, shown until the details arrive. */
  title?: string;
  by?: string;
}

async function startMusic(session: Session): Promise<void> {
  // The stream resolves while the queue is looked up, instead of after it.
  warmMusicStream(session.video);
  const page = await getMusicQueue(session.queue.length > 0 ? session.queue : [session.video]);
  const byId = new Map(page.items.map((track) => [track.videoId ?? track.id, track]));
  const tracks = session.queue.flatMap((id) => byId.get(id) ?? []);
  const index = tracks.findIndex((track) => (track.videoId ?? track.id) === session.video);
  if (index < 0) throw new Error("unavailable");
  usePlayerStore.getState().setIsPlaying(false);
  await useMusicPlayerStore
    .getState()
    .playQueue(tracks, index, null, { at: session.pos / 1000, autoplay: session.state === "playing" });
}

/** Opens the watch page on the video at once; the page loads its details as it always does. */
function startVideo(session: Session, watch: (videoId: string) => void): void {
  prefetchStreamInfo(session.video);
  const ids = session.queue.length > 0 ? session.queue : [session.video];
  const queue = ids.map(
    (id): VideoSummary =>
      id === session.video
        ? { id, title: session.title ?? "", channelName: session.by ?? "" }
        : { id, title: "", channelName: "" },
  );
  const index = Math.max(0, ids.indexOf(session.video));
  useMusicPlayerStore.getState().pause();
  const player = usePlayerStore.getState();
  player.setQueue(queue, index);
  player.setPipHandoff(session.video, session.pos / 1000, session.state === "playing");
  watch(session.video);
}

/** Starts a session handed to this device; `watch` opens the video page. */
export async function startSession(session: Session, watch: (videoId: string) => void): Promise<void> {
  if (session.music) await startMusic(session);
  else startVideo(session, watch);
}

/** Applies a remote command to the player in use. Resolves to false when it can't. */
export async function applyCommand(cmd: Cmd): Promise<boolean> {
  const current = playing();
  if (!current) return false;
  const music = useMusicPlayerStore.getState();
  const video = usePlayerStore.getState();
  switch (cmd.cmd) {
    case "play":
      if (current.music) music.play();
      else video.setIsPlaying(true);
      return true;
    case "pause":
      if (current.music) music.pause();
      else video.setIsPlaying(false);
      return true;
    case "seek":
      if (cmd.pos === undefined) return false;
      if (current.music) music.seek(cmd.pos / 1000);
      else seekToTime(cmd.pos / 1000);
      return true;
    case "next":
      if (current.music) music.next();
      else video.playNext();
      return true;
    case "previous":
      if (current.music) music.previous();
      else video.playPrevious();
      return true;
    case "volume":
      if (cmd.vol === undefined) return false;
      if (current.music) music.setVolume(cmd.vol / 100);
      else video.setVolume(cmd.vol / 100);
      return true;
    case "queue":
      if (!cmd.queue) return false;
      await replaceQueue(current.music, cmd.queue);
      return true;
  }
}

/** Replaces the queue of the player in use from video ids; the video playing carries on. */
async function replaceQueue(music: boolean, ids: string[]): Promise<void> {
  if (!music) {
    usePlayerStore.getState().replaceQueue(ids.map((id): VideoSummary => ({ id, title: "", channelName: "" })));
    return;
  }
  const page = ids.length > 0 ? await getMusicQueue(ids) : { items: [] };
  const byId = new Map(page.items.map((track) => [track.videoId ?? track.id, track]));
  useMusicPlayerStore.getState().replaceQueue(ids.flatMap((id) => byId.get(id) ?? []));
}
