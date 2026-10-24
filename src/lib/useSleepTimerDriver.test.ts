import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { engine, music, video, quitApp } = vi.hoisted(() => ({
  engine: {
    fadeOut: vi.fn(),
    resetFade: vi.fn(),
    getDuration: vi.fn(() => 200),
    getCurrentTime: vi.fn(() => 0),
  },
  music: { isPlaying: true, duration: 200, pause: vi.fn() },
  video: { isPlaying: false, setIsPlaying: vi.fn() },
  quitApp: vi.fn(async () => {}),
}));

vi.mock("./audio/musicAudioEngine", () => ({ musicAudioEngine: engine }));
vi.mock("../store/useMusicPlayerStore", () => ({ useMusicPlayerStore: { getState: () => music } }));
vi.mock("../store/usePlayerStore", () => ({ usePlayerStore: { getState: () => video } }));
vi.mock("./api/process", () => ({ quitApp }));
vi.mock("../store/useAppSettingsStore", () => ({ getSettingValue: () => "false", setSettingValue: vi.fn() }));

import { useSleepTimerStore } from "../store/useSleepTimerStore";
import { sleepTimerTakesEnd, tickSleepTimer } from "./useSleepTimerDriver";

const timer = () => useSleepTimerStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  music.isPlaying = true;
  video.isPlaying = false;
});

afterEach(() => {
  timer().cancel();
  tickSleepTimer();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the shared sleep timer", () => {
  it("leaves the music alone until the last 20 seconds, then fades it out on the audio clock", () => {
    timer().start(10, false);
    vi.advanceTimersByTime(9 * 60_000);
    tickSleepTimer();
    expect(engine.fadeOut).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50_000);
    tickSleepTimer();
    expect(engine.fadeOut).toHaveBeenLastCalledWith(0.5, 10);
  });

  it("pauses the music and the video when it runs out, and restores the volume", () => {
    video.isPlaying = true;
    timer().start(15, false);
    vi.advanceTimersByTime(15 * 60_000 - 5_000);
    tickSleepTimer();
    vi.advanceTimersByTime(5_000);
    tickSleepTimer();

    expect(music.pause).toHaveBeenCalled();
    expect(video.setIsPlaying).toHaveBeenCalledWith(false);
    expect(engine.resetFade).toHaveBeenCalled();
    expect(timer().mode).toBe("off");
    expect(quitApp).not.toHaveBeenCalled();
  });

  it("quits Flow after the pause when asked to", () => {
    timer().start(10, true);
    vi.advanceTimersByTime(10 * 60_000);
    tickSleepTimer();
    expect(quitApp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("stops at the end of the song in End of song mode, fading the song's last seconds", () => {
    expect(sleepTimerTakesEnd()).toBe(false);
    timer().startEndOfSong(false);
    engine.getCurrentTime.mockReturnValue(190);
    tickSleepTimer();
    expect(engine.fadeOut).toHaveBeenLastCalledWith(0.5, 10);

    expect(sleepTimerTakesEnd()).toBe(true);
    expect(timer().mode).toBe("off");
    expect(sleepTimerTakesEnd()).toBe(false);
  });

  it("puts the volume back when the timer is turned off mid-fade", () => {
    timer().start(10, false);
    vi.advanceTimersByTime(10 * 60_000 - 10_000);
    tickSleepTimer();
    timer().cancel();
    tickSleepTimer();
    expect(engine.resetFade).toHaveBeenCalled();
  });
});
