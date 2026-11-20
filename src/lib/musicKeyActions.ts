import { musicAudioEngine } from "./audio/musicAudioEngine";
import type { MusicPlayerKeyAction } from "./musicPlayerKeys";
import { toggleSongLikeWithToast } from "./songLikeToast";
import { useEqStore } from "../store/useEqStore";
import { useLikesStore } from "../store/useLikesStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";

/** Does what a music key asks: the full player's keys and the music bar's share this. */
export function applyMusicKeyAction(action: MusicPlayerKeyAction): void {
  const store = useMusicPlayerStore.getState();
  const position = musicAudioEngine.getCurrentTime();
  switch (action.kind) {
    case "toggle-play":
      store.togglePlay();
      break;
    case "seek-by":
      store.seek(Math.min(Math.max(0, position + action.seconds), Math.max(0, store.duration - 1)));
      break;
    case "seek-to-fraction":
      if (store.duration > 0) store.seek(store.duration * action.fraction);
      break;
    case "volume-by":
      store.setVolume(Math.min(1, Math.max(0, store.volume + action.delta)));
      break;
    case "toggle-mute":
      store.toggleMute();
      break;
    case "next":
      store.next();
      break;
    case "previous":
      store.previous();
      break;
    case "toggle-shuffle":
      store.toggleShuffle();
      break;
    case "cycle-repeat":
      store.cycleRepeat();
      break;
    case "toggle-queue":
      store.setViewState(store.viewState === "queue" ? "full" : "queue");
      break;
    case "toggle-lyrics":
      store.setViewState(store.viewState === "lyrics" ? "full" : "lyrics");
      break;
    case "toggle-like":
      if (store.currentTrack) {
        void toggleSongLikeWithToast(store.currentTrack, useLikesStore.getState().isLikedSong(store.currentTrack));
      }
      break;
    case "open-equalizer":
      useEqStore.getState().setEditorOpen(true);
      break;
  }
}
