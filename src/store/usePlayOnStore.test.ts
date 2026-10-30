import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveRequest } from "../lib/api/live";

vi.mock("../lib/api/linked", () => ({ getLinkedDevices: vi.fn(async () => []) }));
const api = vi.hoisted(() => ({
  getLiveStatus: vi.fn(),
  onLive: vi.fn(),
  onLiveRequest: vi.fn(),
  sendLive: vi.fn(),
  setConsent: vi.fn(),
}));
const players = vi.hoisted(() => ({
  applyCommand: vi.fn(),
  pauseHere: vi.fn(),
  playing: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("../lib/api/live", () => api);
vi.mock("../lib/live/players", () => players);

import { usePlayOnStore } from "./usePlayOnStore";

let deliver: (request: LiveRequest) => void = () => undefined;
const PLAY: LiveRequest = {
  from: "aa",
  seq: 4,
  ask: false,
  message: { type: "play", to: "me", video: "v1", pos: 5000, music: false, link: null, queue: ["v1"], index: 0, state: "playing" },
};
const PLAYING = { video: "v1", title: "T", by: "C", music: false, position: 5, duration: 60, playing: true, volume: 1, queue: ["v1"], index: 0 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetAllMocks();
  api.onLive.mockResolvedValue(() => undefined);
  api.onLiveRequest.mockImplementation(async (handler: (request: LiveRequest) => void) => {
    deliver = handler;
    return () => undefined;
  });
  api.getLiveStatus.mockResolvedValue({ available: true, devices: {}, online: [] });
  api.sendLive.mockResolvedValue(9);
  usePlayOnStore.setState({ status: null, linked: [], asking: [] });
  await usePlayOnStore.getState().init(() => undefined);
});

describe("usePlayOnStore", () => {
  it("plays a session handed to it and answers ok", async () => {
    players.startSession.mockResolvedValue(undefined);
    deliver(PLAY);
    await flush();
    expect(players.startSession).toHaveBeenCalledOnce();
    expect(api.sendLive).toHaveBeenCalledWith({ type: "result", to: "aa", ref: 4, ok: true });
  });

  it("answers a command it can't apply with a reason", async () => {
    players.applyCommand.mockResolvedValue(false);
    deliver({ ...PLAY, message: { type: "cmd", to: "me", cmd: "seek" } });
    await flush();
    expect(api.sendLive).toHaveBeenCalledWith({ type: "result", to: "aa", ref: 4, ok: false, reason: "unsupported" });
  });

  it("asks before acting for a new device, then remembers allow always", async () => {
    players.startSession.mockResolvedValue(undefined);
    deliver({ ...PLAY, ask: true });
    await flush();
    expect(players.startSession).not.toHaveBeenCalled();
    expect(usePlayOnStore.getState().asking).toHaveLength(1);
    await usePlayOnStore.getState().answer("always");
    expect(api.setConsent).toHaveBeenCalledWith("aa", true);
    expect(players.startSession).toHaveBeenCalledOnce();
    expect(usePlayOnStore.getState().asking).toHaveLength(0);
  });

  it("remembers a decline and says so to the sender", async () => {
    deliver({ ...PLAY, ask: true });
    await usePlayOnStore.getState().answer("decline");
    expect(api.setConsent).toHaveBeenCalledWith("aa", false);
    expect(api.sendLive).toHaveBeenCalledWith({ type: "result", to: "aa", ref: 4, ok: false, reason: "declined" });
    expect(players.startSession).not.toHaveBeenCalled();
  });

  it("pauses here only once the target answered that it plays", async () => {
    players.playing.mockReturnValue(PLAYING);
    const handing = usePlayOnStore.getState().transferTo("bb");
    await flush();
    expect(api.sendLive).toHaveBeenCalledWith(expect.objectContaining({ type: "play", to: "bb", video: "v1", pos: 5000 }));
    expect(players.pauseHere).not.toHaveBeenCalled();
    deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
    await handing;
    expect(players.pauseHere).toHaveBeenCalledOnce();
  });

  it("keeps playing here when the target refuses", async () => {
    players.playing.mockReturnValue(PLAYING);
    const handing = usePlayOnStore.getState().transferTo("bb");
    await flush();
    deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: false, reason: "declined" } });
    await expect(handing).rejects.toThrow("declined");
    expect(players.pauseHere).not.toHaveBeenCalled();
  });
});
