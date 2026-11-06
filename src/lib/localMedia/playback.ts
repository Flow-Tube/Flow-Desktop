import { getString } from "../i18n/index";
import { fisherYates } from "../musicShuffle";
import type { LocalMediaFile } from "../api/localMedia";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { remoteControl } from "../../store/useRemoteControlStore";
import { useUiStore } from "../../store/useUiStore";
import { localFileToSong, localFileToVideo } from "./items";

/**
 * Plays `files` from `start`: songs in the music player, videos in the video player, whose page
 * `navigate` opens. While this computer controls another device nothing starts, since that device
 * can't reach a file here.
 */
export function playLocalFiles(
  files: LocalMediaFile[],
  start: number,
  navigate: (path: string) => void,
  options?: { shuffle?: boolean },
): void {
  if (files.length === 0) return;
  if (remoteControl()) {
    useUiStore.getState().showToast({ variant: "error", message: getString("local_no_remote") });
    return;
  }
  const ordered = options?.shuffle ? fisherYates(files) : files;
  const first = options?.shuffle ? 0 : start;
  const opened = ordered[first];
  if (!opened) return;
  if (opened.kind === "audio") {
    void useMusicPlayerStore
      .getState()
      .playQueue(ordered.map(localFileToSong), first, getString("library_local_media_label"));
    return;
  }
  usePlayerStore.getState().setQueue(ordered.map(localFileToVideo), first);
  navigate(`/watch/${opened.id}`);
}

export function queueLocalFile(file: LocalMediaFile, next: boolean): void {
  if (file.kind === "audio") {
    const player = useMusicPlayerStore.getState();
    const song = localFileToSong(file);
    if (next) player.playNextInQueue(song);
    else player.addToQueue(song);
    return;
  }
  usePlayerStore.getState().addToQueue(localFileToVideo(file));
}
