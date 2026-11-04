import { describe, expect, it } from "vitest";

import type { LinkedDevice } from "../api/linked";
import type { LiveStatus, Now } from "../api/live";
import { nowOf } from "./now";
import { activeOf, playOnDevices } from "./devices";

const playingNow = (video: string): Now => ({ ...nowOf(null), video, state: "playing" });
const linked = (id: string, extra: Partial<LinkedDevice> = {}): LinkedDevice => ({
  id,
  name: id.toUpperCase(),
  platform: "android",
  thisDevice: false,
  nearby: false,
  lastSyncMs: 1000,
  ...extra,
});
const STATUS: LiveStatus = {
  available: true,
  online: ["phone", "tv"],
  devices: {
    phone: { kind: "phone", can: ["play", "remote"], now: playingNow("p"), nowAtMs: 50, heardAtMs: 50 },
    tv: { kind: "tv", can: ["play"], now: { ...playingNow("t"), state: "paused" }, nowAtMs: 60, heardAtMs: 60 },
    tablet: { kind: "tablet", can: ["play"], now: playingNow("old"), nowAtMs: 70, heardAtMs: 0 },
  },
};

describe("playOnDevices", () => {
  const devices = playOnDevices(
    STATUS,
    [linked("me", { thisDevice: true, platform: "macos" }), linked("phone"), linked("tv"), linked("tablet")],
    nowOf(null),
    100,
  );

  it("groups playing, available and offline devices, this one first in its group", () => {
    expect(devices.map((d) => [d.did, d.group])).toEqual([
      ["phone", "playing"],
      ["me", "available"],
      ["tv", "available"],
      ["tablet", "offline"],
    ]);
  });

  it("forgets what an offline device last said, and keeps when it was last seen", () => {
    const tablet = devices.find((d) => d.did === "tablet");
    expect(tablet).toMatchObject({ now: null, lastSeenMs: 1000, kind: "tablet" });
  });

  it("counts a device heard from in the last 90 s as reachable though no server lists it", () => {
    const heard: LiveStatus = {
      available: true,
      online: [],
      devices: { phone: { kind: "phone", can: ["play", "remote"], now: playingNow("p"), nowAtMs: 10_000, heardAtMs: 10_000 } },
    };
    expect(playOnDevices(heard, [linked("phone")], nowOf(null), 60_000)[0]?.group).toBe("playing");
    expect(playOnDevices(heard, [linked("phone")], nowOf(null), 100_001)[0]?.group).toBe("offline");
  });

  it("no longer counts a device as playing once its playing now is over 75 s old", () => {
    const phone = playOnDevices(STATUS, [linked("phone")], nowOf(null), 75_050)[0];
    expect(phone?.group).toBe("available");
    expect(phone?.now?.video).toBe("p");
  });

  it("makes the latest playing device active, this one included", () => {
    expect(activeOf(devices)?.did).toBe("phone");
    const here = playOnDevices(STATUS, [linked("me", { thisDevice: true }), linked("phone")], playingNow("m"), 100);
    expect(activeOf(here)?.did).toBe("me");
  });
});
