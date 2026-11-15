import { describe, expect, it } from "vitest";
import { pillSlots } from "./pillGroups";

describe("pillSlots", () => {
  it("joins Previous, Play/pause and Next chosen side by side", () => {
    expect(pillSlots(["previous", "play_pause", "next", "lyrics"], true)).toEqual([
      { kind: "transport", buttons: ["previous", "play_pause", "next"] },
      { kind: "button", button: "lyrics" },
    ]);
  });

  it("keeps plain icons with Split buttons off", () => {
    expect(pillSlots(["previous", "play_pause"], false).every((slot) => slot.kind === "button")).toBe(true);
  });

  it("joins only runs that hold Play/pause", () => {
    expect(pillSlots(["previous", "next", "queue"], true)).toEqual([
      { kind: "button", button: "previous" },
      { kind: "button", button: "next" },
      { kind: "button", button: "queue" },
    ]);
    expect(pillSlots(["play_pause", "lyrics", "next"], true).map((slot) => slot.kind)).toEqual(["button", "button", "button"]);
  });
});
