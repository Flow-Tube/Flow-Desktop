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

    expect(useSubscriptionStore.getState().subscriptions).toEqual([expect.objectContaining(real)]);
    expect(JSON.parse(settings.get("subscriptions") ?? "[]")).toEqual([expect.objectContaining(real)]);
  });

  it("leaves untouched subscription lists as-is without rewriting them", async () => {
    // Already carries a timestamp, so the one-time sync backfill has nothing to do — a load must
    // still not touch the blob. (The backfill itself is covered below, including that it runs once.)
    const subs = [{ id: "UC1234567890abcdefghijkl", name: "Kept", subscribedAt: 1781000000000 }];
    settings.set("subscriptions", JSON.stringify(subs));
    const before = settings.get("subscriptions");

    await useSubscriptionStore.getState().loadSubscriptions();

    expect(useSubscriptionStore.getState().subscriptions).toEqual(subs);
    expect(settings.get("subscriptions")).toBe(before);
  });
});

describe("useSubscriptionStore unsubscribe tombstones", () => {
  beforeEach(() => {
    settings.clear();
    useSubscriptionStore.setState({ subscriptions: [], subscriptionGroups: [], loading: false });
  });

  const tombstones = () => JSON.parse(settings.get("subscription_tombstones") ?? "{}");

  it("records an unsubscribe so the next sync does not put the channel back", async () => {
    await useSubscriptionStore.getState().subscribe("UCx", "Cool");
    await useSubscriptionStore.getState().unsubscribe("UCx");

    expect(useSubscriptionStore.getState().subscriptions).toEqual([]);
    expect(Object.keys(tombstones())).toEqual(["UCx"]);
  });

  it("clears the tombstone when the channel is followed again", async () => {
    await useSubscriptionStore.getState().subscribe("UCx", "Cool");
    await useSubscriptionStore.getState().unsubscribe("UCx");
    await useSubscriptionStore.getState().subscribe("UCx", "Cool");

    expect(tombstones()).toEqual({});
  });

  it("prunes tombstones past the one-year TTL", async () => {
    const stale = Date.now() - 400 * 24 * 60 * 60 * 1000;
    settings.set("subscription_tombstones", JSON.stringify({ UCold: stale }));

    await useSubscriptionStore.getState().subscribe("UCnew", "New");
    await useSubscriptionStore.getState().unsubscribe("UCnew");

    expect(Object.keys(tombstones())).toEqual(["UCnew"]);
  });

  it("stamps a subscribe so it can outrank an older unsubscribe from another device", async () => {
    await useSubscriptionStore.getState().subscribe("UCx", "Cool");
    const channel = useSubscriptionStore.getState().subscriptions[0];

    expect(channel?.subscribedAt).toBeGreaterThan(0);
  });

  it("backfills a timestamp onto pre-sync subscriptions exactly once", async () => {
    settings.set("subscriptions", JSON.stringify([{ id: "UCold", name: "Legacy" }]));

    await useSubscriptionStore.getState().loadSubscriptions();
    const stamped = useSubscriptionStore.getState().subscriptions[0]?.subscribedAt;
    expect(stamped).toBeGreaterThan(0);

    await useSubscriptionStore.getState().loadSubscriptions();
    expect(useSubscriptionStore.getState().subscriptions[0]?.subscribedAt).toBe(stamped);
  });
});
