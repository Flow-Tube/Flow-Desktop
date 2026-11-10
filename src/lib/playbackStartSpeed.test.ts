// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isMusicPlayback,
  parseChannelSpeeds,
  startSpeedOverride,
  usePlaybackStartSpeed,
} from "./playbackStartSpeed";
import { usePlayerStore } from "../store/usePlayerStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { SETTINGS } from "./settings/schema";

vi.mock("./api/db", async (original) => ({ ...(await original<object>()), setSetting: vi.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("startSpeedOverride", () => {
  it("puts a channel's speed before music at normal speed", () => {
    expect(startSpeedOverride({ channelSpeed: 1.5, isMusic: true, musicAtNormalSpeed: true })).toBe(1.5);
    expect(startSpeedOverride({ channelSpeed: null, isMusic: true, musicAtNormalSpeed: true })).toBe(1);
    expect(startSpeedOverride({ channelSpeed: null, isMusic: true, musicAtNormalSpeed: false })).toBeNull();
    expect(startSpeedOverride({ channelSpeed: null, isMusic: false, musicAtNormalSpeed: true })).toBeNull();
  });

  it("reads music from the card or the category", () => {
    expect(isMusicPlayback({ channelName: "Band - Topic" }, null)).toBe(true);
    expect(isMusicPlayback({ channelName: "Band" }, "Music")).toBe(true);
    expect(isMusicPlayback({ channelName: "Band" }, "Gaming")).toBe(false);
  });

  it("survives a damaged saved value", () => {
    expect(parseChannelSpeeds("not json")).toEqual({});
    expect(parseChannelSpeeds("[1]")).toEqual({});
    expect(parseChannelSpeeds('{"a":1.5,"b":"x"}')).toEqual({ a: 1.5 });
  });
});

describe("usePlaybackStartSpeed", () => {
  let root: Root;
  let pick: (rate: number) => void;
  function Probe({ id, category }: { id: string; category?: string }) {
    pick = usePlaybackStartSpeed(id, 1.25, category);
    return null;
  }
  const settings = (values: Record<string, string>) =>
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, ...values } }));
  const video = (channelId?: string) =>
    usePlayerStore.setState({ currentVideo: { id: "v", title: "t", channelName: "c", channelId } });

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
    settings({
      [SETTINGS.SPEED_PER_CHANNEL]: "true",
      [SETTINGS.MUSIC_AT_NORMAL_SPEED]: "true",
      [SETTINGS.CHANNEL_PLAYBACK_SPEEDS]: '{"known":1.75}',
    });
    usePlayerStore.setState({ playbackRate: 1 });
  });
  afterEach(() => act(() => root.unmount()));

  it("starts at the default without an override, and the next video gets the default back", () => {
    video("known");
    act(() => root.render(createElement(Probe, { id: "a" })));
    expect(usePlayerStore.getState().playbackRate).toBe(1.75);
    video("other");
    act(() => root.render(createElement(Probe, { id: "b" })));
    expect(usePlayerStore.getState().playbackRate).toBe(1.25);
  });

  it("applies a channel or category that arrives after the start", () => {
    video(undefined);
    act(() => root.render(createElement(Probe, { id: "a" })));
    expect(usePlayerStore.getState().playbackRate).toBe(1.25);
    act(() => video("known"));
    expect(usePlayerStore.getState().playbackRate).toBe(1.75);
  });

  it("leaves a speed the viewer already picked alone", () => {
    video("other");
    act(() => root.render(createElement(Probe, { id: "a" })));
    act(() => {
      usePlayerStore.setState({ playbackRate: 2 });
      pick(2);
    });
    act(() => root.render(createElement(Probe, { id: "a", category: "Music" })));
    expect(usePlayerStore.getState().playbackRate).toBe(2);
  });

  it("saves a picked speed under the channel, keeping the others", () => {
    video("other");
    act(() => root.render(createElement(Probe, { id: "a" })));
    act(() => pick(2));
    expect(JSON.parse(useAppSettingsStore.getState().values[SETTINGS.CHANNEL_PLAYBACK_SPEEDS]!)).toEqual({ known: 1.75, other: 2 });
  });

  it("saves nothing with the switch off", () => {
    settings({ [SETTINGS.SPEED_PER_CHANNEL]: "false" });
    video("other");
    act(() => root.render(createElement(Probe, { id: "a" })));
    act(() => pick(2));
    expect(JSON.parse(useAppSettingsStore.getState().values[SETTINGS.CHANNEL_PLAYBACK_SPEEDS]!)).toEqual({ known: 1.75 });
  });
});
