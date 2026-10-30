import { create } from "zustand";

import { getLinkedDevices, type LinkedDevice } from "../lib/api/linked";
import {
  getLiveStatus,
  onLive,
  onLiveRequest,
  sendLive,
  setConsent,
  type Answer,
  type Command,
  type LiveRequest,
  type LiveStatus,
  type Now,
} from "../lib/api/live";
import { nowOf } from "../lib/live/now";
import { applyCommand, pauseHere, playing, startSession } from "../lib/live/players";
import { activeDevice, positionOf } from "../lib/live/position";

/** How long a handoff waits for the target's answer. */
const ANSWER_WITHIN_MS = 15_000;

export type ConsentChoice = "always" | "once" | "decline";

interface PlayOnState {
  status: LiveStatus | null;
  /** The group's devices with their names, loaded once another device can be reached. */
  linked: LinkedDevice[];
  /** Requests waiting until the user allows their sender, oldest first. */
  asking: LiveRequest[];
  /** Listens to the live channel; `watch` opens a video's page. Resolves to a function that stops. */
  init: (watch: (videoId: string) => void) => Promise<() => void>;
  /** Hands what plays here to `did`, and pauses here only once it answered that it plays. */
  transferTo: (did: string) => Promise<void>;
  /** Pauses `did` and plays its session here, from where it is now. */
  pullFrom: (did: string) => Promise<void>;
  /**
   * Moves playback to `did`: from here when this device plays, otherwise from the active device,
   * which pauses once `did` answered that it plays.
   */
  moveTo: (did: string) => Promise<void>;
  /** Drives the player here, or on `did`. */
  drive: (did: string | null, cmd: Command, value?: { pos?: number; vol?: number }) => Promise<void>;
  /** Answers the oldest question in `asking`. */
  answer: (choice: ConsentChoice) => Promise<void>;
}

let watch: (videoId: string) => void = () => undefined;
const waiting = new Map<number, (answer: Answer) => void>();

function answerFor(request: LiveRequest, ok: boolean, reason?: string): Answer {
  return { type: "result", to: request.from, ref: request.seq, ok, ...(reason ? { reason } : {}) };
}

/** Plays or applies a request this device was allowed to take, and answers it. */
async function act(request: LiveRequest): Promise<void> {
  const { message } = request;
  let result: Answer;
  if (message.type === "play") {
    result = await startSession(message, watch).then(
      () => answerFor(request, true),
      () => answerFor(request, false, "unavailable"),
    );
  } else if (message.type === "cmd") {
    result = (await applyCommand(message).catch(() => false))
      ? answerFor(request, true)
      : answerFor(request, false, "unsupported");
  } else {
    return;
  }
  await sendLive(result).catch(() => undefined);
}

/** Sends `now`'s session to `to` from `pos`, and resolves once it answered that it plays. */
async function handOff(to: string, now: Now & { video: string }, pos: number): Promise<void> {
  const seq = await sendLive({
    type: "play",
    to,
    video: now.video,
    pos,
    music: now.music,
    link: null,
    queue: now.queue,
    index: now.index,
    state: "playing",
  });
  const answer = await waitForAnswer(seq);
  if (!answer.ok) throw new Error(answer.reason ?? "refused");
}

function waitForAnswer(seq: number): Promise<Answer> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(seq);
      resolve({ type: "result", to: "", ref: seq, ok: false, reason: "timeout" });
    }, ANSWER_WITHIN_MS);
    waiting.set(seq, (answer) => {
      clearTimeout(timer);
      waiting.delete(seq);
      resolve(answer);
    });
  });
}

export const usePlayOnStore = create<PlayOnState>((set, get) => {
  function take(request: LiveRequest) {
    const { message } = request;
    if (message.type === "result") waiting.get(message.ref)?.(message);
    else if (request.ask) set({ asking: [...get().asking, request] });
    else void act(request);
  }

  /** Takes the live status, and loads the devices' names when one isn't known yet. */
  function track(status: LiveStatus | null) {
    set({ status });
    const known = new Set(get().linked.map((device) => device.id));
    const unknown = status?.online.some((did) => !known.has(did)) || (status?.available && known.size === 0);
    if (unknown) getLinkedDevices().then((linked) => set({ linked }), () => undefined);
  }

  return {
    status: null,
    linked: [],
    asking: [],

    init: async (open) => {
      watch = open;
      const stops = await Promise.all([onLive(track), onLiveRequest(take)]);
      track(await getLiveStatus().catch(() => null));
      return () => stops.forEach((stop) => stop());
    },

    transferTo: async (did) => {
      const now = nowOf(playing());
      if (!now.video) return;
      await handOff(did, { ...now, video: now.video }, now.pos);
      pauseHere();
    },

    pullFrom: async (did) => {
      const device = get().status?.devices[did];
      const now = device?.now;
      if (!device || !now?.video) return;
      await sendLive({ type: "cmd", to: did, cmd: "pause" });
      const session = { ...now, video: now.video, pos: positionOf(device, Date.now()), state: "playing" as const };
      await startSession(session, watch);
    },

    moveTo: async (did) => {
      if (playing()?.playing) return get().transferTo(did);
      const active = activeDevice(get().status);
      const device = active ? get().status?.devices[active] : undefined;
      const now = device?.now;
      if (!active || active === did || !device || !now?.video) return;
      await handOff(did, { ...now, video: now.video }, positionOf(device, Date.now()));
      await sendLive({ type: "cmd", to: active, cmd: "pause" });
    },

    drive: async (did, cmd, value) => {
      if (did) await sendLive({ type: "cmd", to: did, cmd, ...value });
      else await applyCommand({ type: "cmd", to: "", cmd, ...value });
    },

    answer: async (choice) => {
      const [request, ...rest] = get().asking;
      if (!request) return;
      set({ asking: rest });
      if (choice === "decline") {
        await setConsent(request.from, false);
        await sendLive(answerFor(request, false, "declined"));
        return;
      }
      if (choice === "always") await setConsent(request.from, true);
      await act(request);
    },
  };
});
