// @vitest-environment jsdom
import { createElement, act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../playon/PlayOnButton", () => ({ PlayOnButton: () => createElement("button", { title: "Play on" }) }));
vi.mock("./PlayerSettingsMenu", () => ({ PlayerSettingsMenu: () => null, qualityLabel: () => "Auto" }));
vi.mock("../../lib/useWheelVolume", () => ({ useWheelVolume: () => () => {} }));

const { FlowPlayerControls, elapsedOrRemaining } = await import("./FlowPlayerControls");
const { useAppSettingsStore } = await import("../../store/useAppSettingsStore");
const { usePlayerStore } = await import("../../store/usePlayerStore");
const { PLAYER_BUTTON_ROWS } = await import("../../lib/playerButtons");
const { getString } = await import("../../lib/i18n/index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
let root: Root;

const render = (fullscreen = false) =>
  act(() =>
    root.render(
      createElement(FlowPlayerControls, {
        containerRef: createRef<HTMLDivElement>(),
        controlsVisible: true,
        setControlsVisible: () => {},
        shouldShowControls: true,
        selectedCaptionId: "off",
        setSelectedCaptionId: () => {},
        setSelectedAudioTrackId: () => {},
        bufferedPct: 0,
        muted: false,
        setMuted: () => {},
        isFullscreen: fullscreen,
        toggleFullscreen: () => {},
        isPip: false,
        togglePictureInPicture: () => {},
        seekTo: () => {},
        togglePlay: () => {},
        stepFrame: () => {},
        settingsOpen: false,
        setSettingsOpen: () => {},
        isScrubbing: false,
        setIsScrubbing: () => {},
      }),
    ),
  );
const hasButton = (title: string) => !!host.querySelector(`button[title="${title}"]`);
const setButton = (id: string, shown: boolean) => {
  const row = PLAYER_BUTTON_ROWS.find((candidate) => candidate.id === id)!;
  useAppSettingsStore.setState((s) => ({ values: { ...s.values, [row.setting]: String(shown) } }));
};

beforeEach(() => {
  useAppSettingsStore.setState((s) => ({
    values: { ...s.values, ...Object.fromEntries(PLAYER_BUTTON_ROWS.map((row) => [row.setting, "true"])) },
  }));
  usePlayerStore.setState({ isCommentsAvailable: true });
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe("player bar buttons", () => {
  it.each([
    ["nextPrevious", "next"],
    ["queue", "queue_title"],
    ["quality", "player_menu_quality"],
    ["captions", "player_menu_captions"],
    ["theater", "player_theater_mode"],
    ["fullscreen", "player_fullscreen"],
  ] as const)("hides %s when switched off", (id, titleKey) => {
    render();
    expect(hasButton(getString(titleKey))).toBe(true);
    act(() => setButton(id, false));
    render();
    expect(hasButton(getString(titleKey))).toBe(false);
  });

  it("hides Play on and the fullscreen comments button", () => {
    render(true);
    expect(hasButton("Play on")).toBe(true);
    expect(hasButton(getString("watch_comments"))).toBe(true);
    act(() => {
      setButton("playOn", false);
      setButton("comments", false);
    });
    render(true);
    expect(hasButton("Play on")).toBe(false);
    expect(hasButton(getString("watch_comments"))).toBe(false);
  });

  it("always keeps Settings", () => {
    act(() => PLAYER_BUTTON_ROWS.forEach((row) => setButton(row.id, false)));
    render();
    expect(hasButton(getString("player_menu_settings"))).toBe(true);
  });
});

describe("small controls", () => {
  const frameStep = (on: boolean) =>
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, frame_step_buttons_enabled: String(on) } }));

  it("shows frame buttons only while paused with the setting on, as the bar had none by default", () => {
    usePlayerStore.setState({ isPlaying: false });
    frameStep(false);
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(false);
    act(() => frameStep(true));
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(true);
    expect(hasButton(getString("player_previous_frame"))).toBe(true);
    act(() => usePlayerStore.setState({ isPlaying: true }));
    render();
    expect(hasButton(getString("player_next_frame"))).toBe(false);
    act(() => frameStep(false));
  });

  it("leaves the idle strip out while the controls show", () => {
    render();
    expect(host.querySelector(".h-\\[3px\\]")).toBeNull();
  });

  it("reads the time pill as elapsed or what is left", () => {
    expect(elapsedOrRemaining(65, 300, false)).toBe("1:05");
    expect(elapsedOrRemaining(65, 300, true)).toBe("-3:55");
    expect(elapsedOrRemaining(400, 300, true)).toBe("-0:00");
    expect(elapsedOrRemaining(65, 0, true)).toBe("1:05");
  });
});
