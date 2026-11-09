import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { SETTINGS } from "../settings/schema";
import { bindMutePause, mutePauseAction } from "./musicMutePause";

describe("mutePauseAction", () => {
  it("pauses playing music when muted, only with the setting on", () => {
    expect(mutePauseAction(true, true, true, false)).toBe("pause");
    expect(mutePauseAction(true, false, true, false)).toBe("none");
    expect(mutePauseAction(true, true, false, false)).toBe("none");
  });

  it("resumes only what it paused", () => {
    expect(mutePauseAction(false, true, false, true)).toBe("resume");
    expect(mutePauseAction(false, true, false, false)).toBe("none");
    expect(mutePauseAction(true, true, false, true)).toBe("none");
  });
});

const { systemOutput } = vi.hoisted(() => ({
  systemOutput: { watching: [] as boolean[], emit: (_silent: boolean) => {} },
}));
vi.mock("../api/systemOutput", () => ({
  watchSystemOutput: vi.fn(async (enabled: boolean) => {
    systemOutput.watching.push(enabled);
    return true;
  }),
  onSystemOutputSilent: vi.fn(async (handler: (silent: boolean) => void) => {
    systemOutput.emit = handler;
    return () => {};
  }),
}));
vi.mock("../api/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

describe("bindMutePause", () => {
  const player = () => useMusicPlayerStore.getState();
  const setEnabled = (on: boolean) =>
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.MUSIC_PAUSE_WHEN_MUTED]: String(on) } }));

  beforeAll(async () => {
    bindMutePause();
    await Promise.resolve();
  });
  beforeEach(() => {
    setEnabled(true);
    useMusicPlayerStore.setState({ currentTrack: { id: "a", videoId: "a" } as never, isPlaying: true, isMuted: false, volume: 0.8 });
  });

  it("watches the system output only while the setting is on", () => {
    setEnabled(false);
    setEnabled(true);
    expect(systemOutput.watching).toEqual([true, false, true]);
  });

  it("pauses on Flow's mute or a zero volume and resumes when sound comes back", () => {
    player().toggleMute();
    expect(player().isPlaying).toBe(false);
    player().toggleMute();
    expect(player().isPlaying).toBe(true);
    player().setVolume(0);
    expect(player().isPlaying).toBe(false);
    player().setVolume(0.5);
    expect(player().isPlaying).toBe(true);
  });

  it("pauses when the computer's output goes silent and resumes after", () => {
    systemOutput.emit(true);
    expect(player().isPlaying).toBe(false);
    systemOutput.emit(false);
    expect(player().isPlaying).toBe(true);
  });

  it("leaves music the listener plays again while muted, and a song paused by hand", () => {
    player().toggleMute();
    player().play();
    player().toggleMute();
    expect(player().isPlaying).toBe(true);

    player().pause();
    player().toggleMute();
    player().toggleMute();
    expect(player().isPlaying).toBe(false);
  });

  it("does nothing with the setting off", () => {
    setEnabled(false);
    player().toggleMute();
    expect(player().isPlaying).toBe(true);
    player().toggleMute();
  });
});
