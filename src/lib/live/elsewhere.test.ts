import { describe, expect, it } from "vitest";

import type { LiveDevice, LiveStatus, Now } from "../api/live";
import { findPlayingElsewhere, withClosedHint } from "./elsewhere";

const now = (video: string, state: Now["state"] = "playing"): Now => ({
  video,
  title: video,
  by: "",
  music: false,
  link: null,
  pos: 0,
  dur: 60_000,
  state,
  vol: 50,
  queue: [video],
  index: 0,
});
const device = (current: Now | null, nowAtMs: number): LiveDevice => ({ kind: "phone", can: ["play", "remote"], now: current, nowAtMs, heardAtMs: nowAtMs });
const status = (devices: Record<string, LiveDevice>): LiveStatus => ({ available: true, online: Object.keys(devices), devices });

describe("findPlayingElsewhere", () => {
  it("offers the device whose playing now arrived last, until it is 75 s old", () => {
    const live = status({ aa: device(now("v1"), 1_000), bb: device(now("v2"), 5_000) });
    expect(findPlayingElsewhere(live, null, {}, 10_000)).toMatchObject({ did: "bb", expiresAtMs: 80_000 });
    expect(findPlayingElsewhere(live, null, {}, 79_999)?.did).toBe("bb");
    expect(findPlayingElsewhere(live, null, {}, 80_000)).toBeNull();
  });

  it("offers nothing while a device is driven from here", () => {
    expect(findPlayingElsewhere(status({ aa: device(now("v1"), 1_000) }), "aa", {}, 2_000)).toBeNull();
  });

  it("leaves out paused and empty devices", () => {
    const live = status({ aa: device(now("v1", "paused"), 1_000), bb: device(null, 1_000) });
    expect(findPlayingElsewhere(live, null, {}, 2_000)).toBeNull();
  });

  it("stays closed for a device until it plays another track", () => {
    const closed = withClosedHint({}, "aa", "v1");
    expect(findPlayingElsewhere(status({ aa: device(now("v1"), 1_000) }), null, closed, 2_000)).toBeNull();
    expect(findPlayingElsewhere(status({ aa: device(now("v2"), 3_000) }), null, closed, 4_000)?.did).toBe("aa");
  });

  it("falls back to another playing device when the latest is closed", () => {
    const live = status({ aa: device(now("v1"), 1_000), bb: device(now("v2"), 5_000) });
    expect(findPlayingElsewhere(live, null, withClosedHint({}, "bb", "v2"), 6_000)?.did).toBe("aa");
  });
});

describe("withClosedHint", () => {
  it("keeps one closed track per device", () => {
    expect(withClosedHint(withClosedHint({}, "aa", "v1"), "aa", "v2")).toEqual({ aa: "v2" });
  });
});
