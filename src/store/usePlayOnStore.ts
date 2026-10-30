import { create } from "zustand";

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
} from "../lib/api/live";
import { nowOf } from "../lib/live/now";
import { applyCommand, pauseHere, playing, startSession } from "../lib/live/players";
import { positionOf } from "../lib/live/position";

/** How long a handoff waits for the target's answer. */
const ANSWER_WITHIN_MS = 15_000;

export type ConsentChoice = "always" | "once" | "decline";

interface PlayOnState {
  status: LiveStatus | null;
  /** Requests waiting until the user allows their sender, oldest first. */
  asking: LiveRequest[];
  /** Listens to the live channel; `watch` opens a video's page. Resolves to a function that stops. */
  init: (watch: (videoId: string) => void) => Promise<() => void>;
  /** Hands what plays here to `did`, and pauses here only once it answered that it plays. */
  transferTo: (did: string) => Promise<void>;
  /** Pauses `did` and plays its session here, from where it is now. */
  pullFrom: (did: string) => Promise<void>;
  control: (did: string, cmd: Command, value?: { pos?: number; vol?: number }) => Promise<void>;
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

  return {
    status: null,
    asking: [],

    init: async (open) => {
      watch = open;
      const stops = await Promise.all([onLive((status) => set({ status })), onLiveRequest(take)]);
      set({ status: await getLiveStatus().catch(() => null) });
      return () => stops.forEach((stop) => stop());
    },

    transferTo: async (did) => {
      const now = nowOf(playing());
      if (!now.video) return;
      const seq = await sendLive({
        type: "play",
        to: did,
        video: now.video,
        pos: now.pos,
        music: now.music,
        link: null,
        queue: now.queue,
        index: now.index,
        state: "playing",
      });
      const answer = await waitForAnswer(seq);
      if (!answer.ok) throw new Error(answer.reason ?? "refused");
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

    control: async (did, cmd, value) => {
      await sendLive({ type: "cmd", to: did, cmd, ...value });
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
