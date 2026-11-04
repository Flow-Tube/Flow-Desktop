import { describe, expect, it } from "vitest";

import type { LiveDevice, LiveStatus, Now } from "../api/live";
import { controlledDevice, currentDevice, positionOf } from "./position";

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
  heardAtMs: nowAtMs,
});

describe("positionOf", () => {
  it("moves a playing video on, and stops at its end", () => {
    expect(positionOf(device("playing", 1000), 4000)).toBe(13_000);
    expect(positionOf(device("playing", 0), 50_000)).toBe(60_000);
  });
  it("stops moving a video whose device stopped saying it plays", () => {
    expect(positionOf(device("playing", 0), 1_000_000)).toBe(10_000);
  });
  it("keeps a paused video where it is", () => {
    expect(positionOf(device("paused", 1000), 9000)).toBe(10_000);
  });
});

describe("currentDevice", () => {
  const status: LiveStatus = {
    available: true,
    online: ["a", "b", "c", "d"],
    devices: { a: device("playing", 1), b: device("playing", 5), c: device("paused", 9), d: device(null, 10) },
  };
  it("is the reachable device that last told of a session, paused included", () => {
    expect(currentDevice(status, 20)).toBe("c");
  });
  it("skips a device that can't be reached", () => {
    expect(currentDevice({ ...status, online: ["a", "b"] }, 200_000)).toBe("b");
  });
  it("is nobody when no device has a session", () => {
    expect(currentDevice({ available: true, online: ["d"], devices: { d: device(null, 1) } }, 20)).toBeNull();
  });
});

describe("controlledDevice", () => {
  const status: LiveStatus = { available: true, online: ["a", "b"], devices: { a: device("paused", 1), b: device("playing", 5) } };
  it("is the device chosen while it has a session", () => {
    expect(controlledDevice(status, "a", 20)).toBe("a");
  });
  it("falls back to the current device when the one chosen has nothing", () => {
    expect(controlledDevice({ ...status, devices: { ...status.devices, a: device(null, 9) } }, "a", 20)).toBe("b");
  });
});
