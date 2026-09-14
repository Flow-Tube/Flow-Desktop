import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canAutoHidePlayerChrome,
  shouldPinPlayerChrome,
  type PlayerChromeConditions,
} from "./playerChrome";

afterEach(() => {
  vi.restoreAllMocks();
});

const playing: PlayerChromeConditions = {
  isPlaying: true,
  settingsOpen: false,
  isScrubbing: false,
  isPipMode: false,
  isLoading: false,
  hasError: false,
};

const canHide = (overrides: Partial<PlayerChromeConditions> = {}) =>
  canAutoHidePlayerChrome({ ...playing, ...overrides });

describe("canAutoHidePlayerChrome", () => {
  it("allows hiding during uninterrupted playback", () => {
    expect(canHide()).toBe(true);
  });

  it("keeps the chrome up whenever playback is interrupted", () => {
    expect(canHide({ isPlaying: false })).toBe(false);
    expect(canHide({ settingsOpen: true })).toBe(false);
    expect(canHide({ isScrubbing: true })).toBe(false);
    expect(canHide({ isPipMode: true })).toBe(false);
    expect(canHide({ isLoading: true })).toBe(false);
    expect(canHide({ hasError: true })).toBe(false);
  });
});

describe("shouldPinPlayerChrome", () => {
  const root = document.createElement("div");
  const control = document.createElement("button");
  root.appendChild(control);
  const outside = document.createElement("button");

  it("pins the chrome for keyboard focus on a control", () => {
    vi.spyOn(control, "matches").mockReturnValue(true);
    expect(shouldPinPlayerChrome(root, control)).toBe(true);
  });

  it("ignores focus that merely followed a click", () => {
    // Clicking play focuses the button too; pinning on that would leave the
    // control bar up for the rest of the video.
    vi.spyOn(control, "matches").mockReturnValue(false);
    expect(shouldPinPlayerChrome(root, control)).toBe(false);
  });

  it("does not count the player root itself as a control", () => {
    expect(shouldPinPlayerChrome(root, root)).toBe(false);
  });

  it("ignores focus that left the player", () => {
    expect(shouldPinPlayerChrome(root, outside)).toBe(false);
    expect(shouldPinPlayerChrome(root, null)).toBe(false);
  });
});
