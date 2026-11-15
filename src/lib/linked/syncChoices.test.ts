import { describe, expect, it, vi } from "vitest";

vi.mock("../api/linked", () => ({ getLeftOut: vi.fn(), setLeftOut: vi.fn() }));

import { SYNC_CHOICES, withChoice } from "./syncChoices";

describe("withChoice", () => {
  it("leaves a choice out and takes it back", () => {
    expect(withChoice([], "likes", false)).toEqual(["likes"]);
    expect(withChoice(["likes", "notes"], "likes", true)).toEqual(["notes"]);
  });

  it("keeps the page's order and no duplicates", () => {
    expect(withChoice(["settings"], "watchHistory", false)).toEqual(["watchHistory", "settings"]);
    expect(withChoice(["likes"], "likes", false)).toEqual(["likes"]);
  });

  it("lists every choice the backend knows, once", () => {
    const keys = SYNC_CHOICES.map(([key]) => key);
    expect(new Set(keys).size).toBe(7);
    expect(keys).toEqual(["watchHistory", "playlists", "likes", "subscriptions", "notes", "recommendations", "settings"]);
  });
});
