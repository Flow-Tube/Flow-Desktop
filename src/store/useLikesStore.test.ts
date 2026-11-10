import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => void settings.set(key, value));
vi.mock("../lib/api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
vi.mock("../lib/api/music", () => ({ getMusicQueue: vi.fn() }));

import { useLikesStore, type LikedItem } from "./useLikesStore";

const like = (id: string, likedAt: string): LikedItem => ({ kind: "video", id, likedAt, video: { id, title: id, channelName: "c" } });
const newer = like("newer", "2026-02-01T00:00:00.000Z");
const older = like("older", "2026-01-01T00:00:00.000Z");
const ids = () => useLikesStore.getState().items.map((item) => item.id);

describe("useLikesStore many at once", () => {
  beforeEach(() => {
    setSetting.mockClear();
    settings.clear();
    useLikesStore.setState({ items: [newer, older], loaded: true });
  });

  it("removes in one write and puts them back in date order", async () => {
    const removed = await useLikesStore.getState().removeMany([newer]);
    expect(ids()).toEqual(["older"]);
    expect(setSetting).toHaveBeenCalledTimes(1);
    await useLikesStore.getState().restore(removed);
    expect(ids()).toEqual(["newer", "older"]);
  });

  it("rolls back a removal the backend refused", async () => {
    setSetting.mockRejectedValueOnce(new Error("db"));
    await expect(useLikesStore.getState().removeMany([newer])).rejects.toThrow("db");
    expect(ids()).toEqual(["newer", "older"]);
  });

  it("does not duplicate on restore", async () => {
    await useLikesStore.getState().restore([older]);
    expect(ids()).toEqual(["newer", "older"]);
  });
});
