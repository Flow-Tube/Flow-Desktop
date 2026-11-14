import { describe, expect, it } from "vitest";

import type { Now } from "../api/live";
import { pickDone, type VolumePick } from "./useVolumePick";

const now = (vol: number): Now => ({
  video: "v",
  title: "",
  by: "",
  music: false,
  link: null,
  pos: 0,
  dur: 60_000,
  state: "playing",
  vol,
  queue: ["v"],
  index: 0,
});
const pick: VolumePick = { did: "bb", vol: 40 };

describe("pickDone", () => {
  it("keeps the pick until it was answered", () => {
    expect(pickDone(pick, null, false, now(40))).toBe(false);
    expect(pickDone(pick, { pick: { did: "bb", vol: 40 }, ok: true, seen: null }, false, now(40))).toBe(false);
  });

  it("keeps the pick while the user holds the slider", () => {
    const shown = now(40);
    expect(pickDone(pick, { pick, ok: true, seen: shown }, true, shown)).toBe(false);
    expect(pickDone(pick, { pick, ok: false, seen: shown }, true, shown)).toBe(false);
  });

  it("follows the device once it shows the pick", () => {
    const shown = now(40);
    expect(pickDone(pick, { pick, ok: true, seen: shown }, false, shown)).toBe(true);
  });

  it("waits for the device's next now when the pick isn't shown yet", () => {
    const before = now(70);
    expect(pickDone(pick, { pick, ok: true, seen: before }, false, before)).toBe(false);
    expect(pickDone(pick, { pick, ok: true, seen: before }, false, now(70))).toBe(true);
  });

  it("goes back to the device's volume when it refused", () => {
    const shown = now(70);
    expect(pickDone(pick, { pick, ok: false, seen: shown }, false, shown)).toBe(true);
  });
});
