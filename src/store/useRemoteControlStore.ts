import { create } from "zustand";

import type { Command } from "../lib/api/live";

/**
 * While this device controls another one (spec/live.md, Playing on another device), every
 * playback action taken here goes there, as in Spotify Connect. The players check `remoteControl`
 * first; "Play on" keeps it current and says how to send.
 */
interface RemoteControlState {
  /** The device controlled, or `null` while playback is here. */
  target: string | null;
  /** What it plays, from its latest `now`. */
  queue: string[];
  index: number;
  playing: boolean;
  /** Sends a command to the device controlled. */
  command: (cmd: Command, value?: { pos?: number; vol?: number; queue?: string[] }) => void;
  /** Starts a new queue there. */
  play: (queue: string[], index: number, music: boolean) => void;
}

export const useRemoteControlStore = create<RemoteControlState>(() => ({
  target: null,
  queue: [],
  index: 0,
  playing: false,
  command: () => undefined,
  play: () => undefined,
}));

/** The remote control, while a device is controlled from here. */
export function remoteControl(): RemoteControlState | null {
  const state = useRemoteControlStore.getState();
  return state.target ? state : null;
}

/** The controlled device's queue with `ids` placed right after what it plays, or at the end. */
export function queueWith(remote: RemoteControlState, ids: string[], next: boolean): string[] {
  const at = next ? remote.index + 1 : remote.queue.length;
  return [...remote.queue.slice(0, at), ...ids, ...remote.queue.slice(at)];
}
