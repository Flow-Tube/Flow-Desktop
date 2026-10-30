import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeBackend } from "./errors";

// Wire types mirror `src-tauri/src/sync2/{live_message,live_hub}.rs`.

export type PlayState = "playing" | "paused";
export type DeviceKind = "phone" | "tablet" | "tv" | "desktop";

/** What a device plays (spec/live.md); positions and durations in milliseconds, volume 0 to 100. */
export interface Now {
  video: string | null;
  title: string;
  by: string;
  music: boolean;
  link: string | null;
  pos: number;
  dur: number;
  state: PlayState;
  vol: number;
  queue: string[];
  index: number;
}

/** A whole playback session handed to device `to`. */
export interface Play {
  type: "play";
  to: string;
  video: string;
  pos: number;
  music: boolean;
  link: string | null;
  queue: string[];
  index: number;
  state: PlayState;
}

export type Command = "play" | "pause" | "seek" | "next" | "previous" | "volume" | "queue";

export interface Cmd {
  type: "cmd";
  to: string;
  cmd: Command;
  pos?: number;
  vol?: number;
  queue?: string[];
}

/** The outcome of the `play` or `cmd` with counter `ref`. */
export interface Answer {
  type: "result";
  to: string;
  ref: number;
  ok: boolean;
  reason?: string;
}

/** A message for this device to act on; `ask` when the user must first allow its sender. */
export interface LiveRequest {
  from: string;
  seq: number;
  message: Play | Cmd | Answer;
  ask: boolean;
}

export interface LiveDevice {
  kind: DeviceKind | null;
  can: Array<"play" | "remote">;
  now: Now | null;
  /** When `now` arrived, so its position can advance while it plays. */
  nowAtMs: number;
}

export interface LiveStatus {
  /** The server's live socket is open, or a member is on the LAN. */
  available: boolean;
  devices: Record<string, LiveDevice>;
  online: string[];
}

export const publishNow = (now: Now) => invokeBackend<void>("live_now", { now });
/** Sends a `play`, `cmd` or `result`; resolves to its counter, which the answer names. */
export const sendLive = (message: Play | Cmd | Answer) => invokeBackend<number>("live_send", { message });
export const getLiveStatus = () => invokeBackend<LiveStatus>("live_status");
/** Remembered answers by device: `true` to allow always, `false` to decline. */
export const getConsents = () => invokeBackend<Record<string, boolean>>("live_consents");
/** `null` forgets the answer, so the device is asked again. */
export const setConsent = (did: string, allowed: boolean | null) =>
  invokeBackend<void>("live_set_consent", { did, allowed });

export const onLive = (handler: (status: LiveStatus) => void): Promise<UnlistenFn> =>
  listen<LiveStatus>("sync2://live", (event) => handler(event.payload));

export const onLiveRequest = (handler: (request: LiveRequest) => void): Promise<UnlistenFn> =>
  listen<LiveRequest>("sync2://live-request", (event) => handler(event.payload));
