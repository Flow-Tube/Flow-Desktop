// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSetting: vi.fn(async (key: string) => key === "playback_speed" ? "1.5" : key === "preferred_audio_language" ? "en" : null),
}));

import { Player } from "./Player";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { getString } from "../../lib/i18n/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Player playback speed", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    usePlayerStore.setState({
      currentVideo: { id: "speed-test", title: "Speed test", channelName: "Test channel" },
      playbackRate: 1,
      isPlaying: false,
    });
    useAppSettingsStore.setState((state) => ({
      ...state,
      values: {
        ...state.values,
        [SETTINGS.PLAYBACK_SPEED]: "1.5",
        [SETTINGS.PREFERRED_AUDIO_LANGUAGE]: "en",
      },
      loaded: false,
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });


  it("shows user speed changes briefly without an initial flash and refreshes on rapid changes", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root.render(createElement(Player, { src: "file:///speed.mp4" }));
    });
    expect(host.querySelector('[role="status"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "<", bubbles: true }));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("1.25x");

    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "<", bubbles: true }));
      vi.advanceTimersByTime(1000);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("1x");
    await act(async () => vi.advanceTimersByTime(401));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("shows the selected speed from the player settings menu", async () => {
    await act(async () => root.render(createElement(Player, { src: "file:///speed.mp4" })));
    await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${getString("player_menu_settings")}"]`)!.click());
    await act(async () => Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.trim().startsWith(getString("player_menu_speed")))!.click());
    await act(async () => Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.trim() === "1.75x")!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("1.75x");
  });
  it("keeps the saved speed across source changes and applies later speed changes to both media elements", async () => {
    const audioTracks = [{
      id: "external-en",
      label: "English",
      languageCode: "en",
      localUrl: "file:///external-audio.m4a",
      isDefault: false,
      available: true,
    }];

    await act(async () => {
      root.render(createElement(Player, { src: "file:///first.mp4", audioTracks }));
    });

    const video = host.querySelector("video")!;
    const audio = host.querySelector("audio")!;
    expect(useAppSettingsStore.getState().values[SETTINGS.PLAYBACK_SPEED]).toBe("1.5");
    expect(usePlayerStore.getState().playbackRate).toBe(1.5);
    expect(video.defaultPlaybackRate).toBe(1.5);
    expect(video.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
    expect(audio.playbackRate).toBe(1.5);

    await act(async () => {
      root.render(createElement(Player, { src: "file:///second.mp4", audioTracks }));
    });

    expect(usePlayerStore.getState().playbackRate).toBe(1.5);
    expect(video.defaultPlaybackRate).toBe(1.5);
    expect(video.playbackRate).toBe(1.5);
    expect(audio.defaultPlaybackRate).toBe(1.5);
    expect(audio.playbackRate).toBe(1.5);

    act(() => usePlayerStore.getState().setPlaybackRate(1.75));
    expect(video.defaultPlaybackRate).toBe(1.75);
    expect(video.playbackRate).toBe(1.75);
    expect(audio.defaultPlaybackRate).toBe(1.75);
    expect(audio.playbackRate).toBe(1.75);
  });
});
