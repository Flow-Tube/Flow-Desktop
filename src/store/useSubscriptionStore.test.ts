import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();

vi.mock("../lib/api/db", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  }),
}));

import { useSubscriptionStore } from "./useSubscriptionStore";

describe("useSubscriptionStore.loadSubscriptions", () => {
  beforeEach(() => {
    settings.clear();
    useSubscriptionStore.setState({ subscriptions: [], subscriptionGroups: [], loading: false });
  });

  it("starts empty on a fresh install and does not seed default channels", async () => {
    await useSubscriptionStore.getState().loadSubscriptions();

    expect(useSubscriptionStore.getState().subscriptions).toEqual([]);
    expect(settings.has("subscriptions")).toBe(false);
  });

  it("strips the fabricated v0.1.0-beta seed channels from persisted subscriptions", async () => {
    const real = { id: "UCsBjURrPoezykLs9EqgamOA", name: "Real Channel" };
    settings.set(
      "subscriptions",
      JSON.stringify([
        { id: "UCsBjURrdU234nU351gVEfTA", name: "Fireship" },
        real,
        { id: "UCwRxwjk_c_92sAMeX4JzW4w", name: "Linus Tech Tips" },
      ]),
    );

    await useSubscriptionStore.getState().loadSubscriptions();

    expect(useSubscriptionStore.getState().subscriptions).toEqual([real]);
    expect(JSON.parse(settings.get("subscriptions") ?? "[]")).toEqual([real]);
  });

  it("leaves untouched subscription lists as-is without rewriting them", async () => {
    const subs = [{ id: "UC1234567890abcdefghijkl", name: "Kept" }];
    settings.set("subscriptions", JSON.stringify(subs));
    const before = settings.get("subscriptions");

    await useSubscriptionStore.getState().loadSubscriptions();

    expect(useSubscriptionStore.getState().subscriptions).toEqual(subs);
    expect(settings.get("subscriptions")).toBe(before);
  });
});
