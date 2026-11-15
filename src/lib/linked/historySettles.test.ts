import { describe, expect, it, vi } from "vitest";

vi.mock("../api/db", () => ({ watchHistorySettled: vi.fn() }));

import { historySettled } from "./historySettles";

describe("historySettled", () => {
  it("settles on pause and stop", () => {
    expect(historySettled({ item: "v1", playing: true }, { item: "v1", playing: false })).toBe(true);
    expect(historySettled({ item: "v1", playing: true }, { item: null, playing: false })).toBe(true);
  });

  it("settles when the player moves on, playing or not", () => {
    expect(historySettled({ item: "v1", playing: true }, { item: "v2", playing: true })).toBe(true);
    expect(historySettled({ item: "v1", playing: false }, { item: "v2", playing: false })).toBe(true);
  });

  it("doesn't settle when playback starts or carries on", () => {
    expect(historySettled({ item: "v1", playing: false }, { item: "v1", playing: true })).toBe(false);
    expect(historySettled({ item: null, playing: false }, { item: "v1", playing: true })).toBe(false);
    expect(historySettled({ item: "v1", playing: true }, { item: "v1", playing: true })).toBe(false);
  });
});
