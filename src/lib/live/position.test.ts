import { describe, expect, it } from "vitest";

import type { LiveDevice, LiveStatus, Now } from "../api/live";
import { activeDevice, positionOf } from "./position";

const now = (state: Now["state"], pos = 10_000): Now => ({
  video: "v",
  title: "",
  by: "",
  music: false,
  link: null,
  pos,
  dur: 60_000,
  state,
  vol: 50,
  queue: ["v"],
  index: 0,
});
const device = (state: Now["state"] | null, nowAtMs: number): LiveDevice => ({
  kind: "phone",
  can: ["play", "remote"],
  now: state ? now(state) : null,
  nowAtMs,
});

describe("positionOf", () => {
  it("moves a playing video on, and stops at its end", () => {
    expect(positionOf(device("playing", 1000), 4000)).toBe(13_000);
    expect(positionOf(device("playing", 0), 1_000_000)).toBe(60_000);
  });
  it("keeps a paused video where it is", () => {
    expect(positionOf(device("paused", 1000), 9000)).toBe(10_000);
  });
});

describe("activeDevice", () => {
  it("is the latest device to say it plays", () => {
    const status: LiveStatus = {
      available: true,
      online: [],
      devices: { a: device("playing", 1), b: device("playing", 5), c: device("paused", 9), d: device(null, 10) },
    };
    expect(activeDevice(status)).toBe("b");
  });
  it("is nobody when nothing plays", () => {
    expect(activeDevice({ available: true, online: [], devices: { a: device("paused", 1) } })).toBeNull();
  });
});
