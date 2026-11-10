import { describe, expect, it } from "vitest";
import { groupChannelsWith } from "./channelGroups";

const group = { name: "Tech", channelIds: ["a", "b"], sortOrder: 0 };

describe("groupChannelsWith", () => {
  it("adds once and removes", () => {
    expect(groupChannelsWith(group, "c", true)).toEqual(["a", "b", "c"]);
    expect(groupChannelsWith(group, "a", true)).toEqual(["b", "a"]);
    expect(groupChannelsWith(group, "a", false)).toEqual(["b"]);
  });
});
