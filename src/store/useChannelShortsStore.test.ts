import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("../lib/api/db", () => db);

import { useChannelShortsStore } from "./useChannelShortsStore";

describe("hidden channel Shorts", () => {
  beforeEach(() => {
    useChannelShortsStore.setState({ excluded: new Set(), loaded: false });
    db.getSetting.mockReset();
    db.setSetting.mockReset().mockResolvedValue(undefined);
  });

  it("reads what was saved", async () => {
    db.getSetting.mockResolvedValue(JSON.stringify(["UC1"]));
    await useChannelShortsStore.getState().load();
    expect(useChannelShortsStore.getState().excluded.has("UC1")).toBe(true);
  });

  it("flips a channel and saves the list", async () => {
    await useChannelShortsStore.getState().toggle("UC1");
    expect(useChannelShortsStore.getState().excluded.has("UC1")).toBe(true);
    expect(db.setSetting).toHaveBeenLastCalledWith("subscription_shorts_excluded_channels", JSON.stringify(["UC1"]));
    await useChannelShortsStore.getState().toggle("UC1");
    expect(useChannelShortsStore.getState().excluded.size).toBe(0);
  });

  it("goes back when the save fails", async () => {
    db.setSetting.mockRejectedValue(new Error("disk full"));
    await useChannelShortsStore.getState().toggle("UC1");
    expect(useChannelShortsStore.getState().excluded.size).toBe(0);
  });
});
