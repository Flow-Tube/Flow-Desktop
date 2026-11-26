import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));

import { readWindowButtonsPlace, showsTitleBar, titleBarHeight } from "./windowButtons";

describe("showsTitleBar", () => {
  it("keeps today's title bar by default", () => {
    expect(readWindowButtonsPlace(undefined)).toBe("titlebar");
    expect(readWindowButtonsPlace("bogus")).toBe("titlebar");
    expect(showsTitleBar("titlebar", true, false)).toBe(true);
  });

  it("drops the bar where the top bar holds the buttons, and keeps it where there is no top bar", () => {
    expect(showsTitleBar("topbar", true, false)).toBe(false);
    expect(showsTitleBar("topbar", false, false)).toBe(true);
  });

  it("never shows a bar with no buttons, or on macOS", () => {
    expect(showsTitleBar("none", false, false)).toBe(false);
    expect(showsTitleBar("titlebar", true, true)).toBe(false);
  });

  it("gives the page no room for a bar that is hidden", () => {
    expect(titleBarHeight(false)).toBe(0);
    expect(titleBarHeight(true)).toBe(32);
  });
});
