import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notifications = vi.hoisted(() => [] as string[]);
const settings = vi.hoisted(() => ({ values: {} as Record<string, string> }));
const playing = vi.hoisted(() => ({ video: false, music: false }));

vi.mock("../api/downloads", () => ({
  showDownloadNotification: async (title: string) => {
    notifications.push(title);
  },
}));
vi.mock("../../store/useAppSettingsStore", () => ({
  useAppSettingsStore: (select: (state: typeof settings) => unknown) => select(settings),
}));
vi.mock("../../store/usePlayerStore", () => ({ usePlayerStore: { getState: () => ({ isPlaying: playing.video }) } }));
vi.mock("../../store/useMusicPlayerStore", () => ({ useMusicPlayerStore: { getState: () => ({ isPlaying: playing.music }) } }));

const { useWellbeingReminders, flowInUse } = await import("./useWellbeingReminders");
const { SETTINGS } = await import("../settings/schema");

const MINUTE = 60_000;
let host: HTMLDivElement;
let root: Root;
let focused: boolean;
let hidden: boolean;

function Reminders() {
  useWellbeingReminders();
  return null;
}

function mount() {
  act(() => root.render(createElement(Reminders)));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 14, 12, 0));
  notifications.length = 0;
  settings.values = {};
  playing.video = false;
  playing.music = false;
  focused = true;
  hidden = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("flowInUse", () => {
  it("needs focus, or a visible window that is playing", () => {
    expect(flowInUse()).toBe(true);
    focused = false;
    expect(flowInUse()).toBe(false);
    playing.video = true;
    expect(flowInUse()).toBe(true);
    hidden = true;
    expect(flowInUse()).toBe(false);
  });
});

describe("the break reminder", () => {
  it("stays quiet when off, and reminds every period when on", () => {
    mount();
    advance(120 * MINUTE);
    expect(notifications).toEqual([]);
    act(() => root.unmount());

    root = createRoot(host);
    settings.values = { [SETTINGS.BREAK_REMINDER]: "true", [SETTINGS.BREAK_FREQUENCY]: "30" };
    mount();
    advance(29 * MINUTE);
    expect(notifications).toEqual([]);
    advance(2 * MINUTE);
    expect(notifications).toEqual(["Take a break"]);
    advance(30 * MINUTE);
    expect(notifications).toHaveLength(2);
  });

  it("doesn't count time Flow isn't in use", () => {
    settings.values = { [SETTINGS.BREAK_REMINDER]: "true", [SETTINGS.BREAK_FREQUENCY]: "30" };
    focused = false;
    mount();
    advance(120 * MINUTE);
    expect(notifications).toEqual([]);
  });
});

describe("the bedtime reminder", () => {
  it("fires once at its time, and again the next day while Flow runs", () => {
    settings.values = { [SETTINGS.BEDTIME_REMINDER]: "true", [SETTINGS.BEDTIME_START]: "23:00" };
    mount();
    advance(10 * 60 * MINUTE + 59 * MINUTE);
    expect(notifications).toEqual([]);
    advance(2 * MINUTE);
    expect(notifications).toEqual(["It's bedtime"]);
    advance(60 * MINUTE);
    expect(notifications).toHaveLength(1);
    advance(24 * 60 * MINUTE);
    expect(notifications).toHaveLength(2);
  });

  it("doesn't fire when Flow opens after its time", () => {
    settings.values = { [SETTINGS.BEDTIME_REMINDER]: "true", [SETTINGS.BEDTIME_START]: "09:00" };
    mount();
    advance(60 * MINUTE);
    expect(notifications).toEqual([]);
  });
});
