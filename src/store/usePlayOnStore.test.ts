import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveRequest, LiveStatus, Now } from "../lib/api/live";

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
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../lib/api/live", () => api);
vi.mock("../lib/live/players", () => players);
vi.mock("./useUiStore", () => ({ useUiStore: { getState: () => ({ showToast }) } }));

import { usePlayOnStore } from "./usePlayOnStore";
import { useRemoteControlStore } from "./useRemoteControlStore";

let deliver: (request: LiveRequest) => void = () => undefined;
let report: (status: LiveStatus) => void = () => undefined;
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
  api.onLive.mockImplementation(async (handler: (status: LiveStatus) => void) => {
    report = handler;
    return () => undefined;
  });
  api.onLiveRequest.mockImplementation(async (handler: (request: LiveRequest) => void) => {
    deliver = handler;
    return () => undefined;
  });
  api.getLiveStatus.mockResolvedValue({ available: true, devices: {}, online: [] });
  api.sendLive.mockResolvedValue(9);
  usePlayOnStore.setState({ status: null, reported: null, overrides: {}, controlling: null, linked: [], asking: [] });
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
    expect(usePlayOnStore.getState().controlling).toBeNull();
    deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
    await handing;
    expect(players.pauseHere).toHaveBeenCalledOnce();
    expect(usePlayOnStore.getState().controlling).toBe("bb");
  });

  it("keeps playing here when the target refuses", async () => {
    players.playing.mockReturnValue(PLAYING);
    const handing = usePlayOnStore.getState().transferTo("bb");
    await flush();
    deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: false, reason: "declined" } });
    await expect(handing).rejects.toThrow("declined");
    expect(players.pauseHere).not.toHaveBeenCalled();
  });

  it("takes an answer that arrived before its wait started", async () => {
    players.playing.mockReturnValue(PLAYING);
    deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
    await usePlayOnStore.getState().transferTo("bb");
    expect(players.pauseHere).toHaveBeenCalledOnce();
  });

  describe("picking a device", () => {
    const SONG: Now = { video: "s1", title: "S", by: "A", music: true, link: null, pos: 2000, dur: 60_000, state: "paused", vol: 100, queue: ["s1"], index: 0 };
    const at = (devices: Record<string, Now | null>): LiveStatus => ({
      available: true,
      online: Object.keys(devices),
      devices: Object.fromEntries(
        Object.entries(devices).map(([did, now]) => [did, { kind: "phone", can: ["play", "remote"], now, nowAtMs: Date.now(), heardAtMs: Date.now() }]),
      ),
    });
    const device = (did: string, now: Now | null, thisDevice = false) => ({
      did,
      name: did,
      kind: "phone" as const,
      thisDevice,
      group: now?.state === "playing" ? ("playing" as const) : ("available" as const),
      now,
      nowAtMs: Date.now(),
      lastSeenMs: null,
    });

    it("drives a device with a session, playing or not, while nothing plays here", async () => {
      report(at({ bb: SONG }));
      await usePlayOnStore.getState().pick(device("bb", SONG));
      expect(usePlayOnStore.getState().controlling).toBe("bb");
      expect(api.sendLive).not.toHaveBeenCalled();
    });

    it("hands what plays here to a device that plays something else", async () => {
      players.playing.mockReturnValue(PLAYING);
      report(at({ bb: { ...SONG, state: "playing" } }));
      const picking = usePlayOnStore.getState().pick(device("bb", { ...SONG, state: "playing" }));
      await flush();
      expect(api.sendLive).toHaveBeenCalledWith(expect.objectContaining({ type: "play", to: "bb", video: "v1" }));
      deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
      await picking;
      expect(players.pauseHere).toHaveBeenCalledOnce();
    });

    it("brings back a paused session from the device that last had one when none is chosen", async () => {
      players.startSession.mockResolvedValue(undefined);
      report(at({ bb: SONG }));
      await usePlayOnStore.getState().pick(device("me", null, true));
      expect(api.sendLive).toHaveBeenCalledWith({ type: "cmd", to: "bb", cmd: "pause" });
      expect(players.startSession).toHaveBeenCalledWith(expect.objectContaining({ video: "s1", pos: 2000, state: "playing" }), expect.any(Function));
    });

    it("moves the driven device's session to another one in its own state, then pauses it", async () => {
      report(at({ bb: SONG, cc: null }));
      usePlayOnStore.getState().control("bb");
      const picking = usePlayOnStore.getState().pick(device("cc", null));
      await flush();
      expect(api.sendLive).toHaveBeenCalledWith(expect.objectContaining({ type: "play", to: "cc", video: "s1", state: "paused" }));
      deliver({ from: "cc", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
      await picking;
      expect(api.sendLive).toHaveBeenLastCalledWith({ type: "cmd", to: "bb", cmd: "pause" });
      expect(usePlayOnStore.getState().controlling).toBe("cc");
    });
  });

  describe("remote commands", () => {
    const NOW: Now = { video: "v1", title: "T", by: "C", music: false, link: null, pos: 1000, dur: 60_000, state: "playing", vol: 50, queue: ["v1"], index: 0 };
    const phone = (now: Now, nowAtMs: number, heardAtMs = nowAtMs): LiveStatus => ({
      available: true,
      online: ["bb"],
      devices: { bb: { kind: "phone", can: ["play", "remote"], now, nowAtMs, heardAtMs } },
    });
    const shownState = () => usePlayOnStore.getState().status?.devices.bb?.now?.state;

    it("shows a pause at once, keeps it once answered, and takes the device's next now", async () => {
      report(phone(NOW, Date.now()));
      const pausing = usePlayOnStore.getState().drive("bb", "pause");
      expect(shownState()).toBe("paused");
      await flush();
      deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: true } });
      await pausing;
      expect(shownState()).toBe("paused");
      report(phone({ ...NOW, state: "playing" }, Date.now() + 1000));
      expect(shownState()).toBe("playing");
    });

    it("follows a device only once the user chose it, until it is gone for 90 s", () => {
      report(phone(NOW, Date.now()));
      expect(usePlayOnStore.getState().controlling).toBeNull();
      usePlayOnStore.getState().control("bb");
      expect(usePlayOnStore.getState().controlling).toBe("bb");
      report({ ...phone(NOW, Date.now()), online: [] });
      expect(usePlayOnStore.getState().controlling).toBe("bb");
      report({ ...phone(NOW, Date.now(), Date.now() - 91_000), online: [] });
      expect(usePlayOnStore.getState().controlling).toBeNull();
    });

    it("routes the players to the device controlled, until a session is handed here", async () => {
      report(phone(NOW, Date.now()));
      usePlayOnStore.getState().control("bb");
      expect(useRemoteControlStore.getState()).toMatchObject({ target: "bb", queue: ["v1"], playing: true });
      players.startSession.mockResolvedValue(undefined);
      deliver(PLAY);
      await flush();
      expect(useRemoteControlStore.getState().target).toBeNull();
      expect(players.startSession).toHaveBeenCalledOnce();
    });

    it("takes the pause back and says so when the device refuses", async () => {
      report(phone(NOW, Date.now()));
      const pausing = usePlayOnStore.getState().drive("bb", "pause");
      await flush();
      deliver({ from: "bb", seq: 1, ask: false, message: { type: "result", to: "me", ref: 9, ok: false, reason: "declined" } });
      await pausing;
      expect(shownState()).toBe("playing");
      expect(showToast).toHaveBeenCalledOnce();
    });
  });
});
