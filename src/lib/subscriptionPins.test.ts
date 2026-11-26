import { describe, expect, it } from "vitest";
import { channelIdsToStorage, parseChannelIds, pinnedFirst, reorderSubset, togglePinned } from "./subscriptionPins";

// The cases of Flow for Android's SubscriptionPinsTest.
const channels = ["a", "m", "b", "c", "d"].map((id) => ({ id }));

describe("pinnedFirst", () => {
  it("puts pins first in pin order", () => {
    const row = pinnedFirst(channels, ["m", "c"]);
    expect(row.channels.map((c) => c.id)).toEqual(["m", "c", "a", "b", "d"]);
    expect(row.pinnedCount).toBe(2);
  });

  it("skips a pin for a channel no longer followed", () => {
    const row = pinnedFirst(channels, ["gone", "b"]);
    expect(row.channels.map((c) => c.id)).toEqual(["b", "a", "m", "c", "d"]);
    expect(row.pinnedCount).toBe(1);
  });
});

describe("stored channel lists", () => {
  it("round-trip through storage and toggle", () => {
    const pins = parseChannelIds(" UCa,UCb,,UCa ");
    expect(pins).toEqual(["UCa", "UCb"]);
    expect(parseChannelIds(channelIdsToStorage(pins))).toEqual(pins);
    expect(togglePinned(pins, "UCc")).toEqual(["UCa", "UCb", "UCc"]);
    expect(togglePinned(pins, "UCa")).toEqual(["UCb"]);
    expect(parseChannelIds(null)).toEqual([]);
  });
});

describe("reorderSubset", () => {
  it("reorders the shown ids in their own slots and leaves the others in place", () => {
    const all = ["v1", "m1", "v2", "m2", "v3"];
    expect(reorderSubset(all, ["v3", "v1", "v2"])).toEqual(["v3", "m1", "v1", "m2", "v2"]);
    expect(reorderSubset(all, ["m2", "m1"])).toEqual(["v1", "m2", "v2", "m1", "v3"]);
  });
});
