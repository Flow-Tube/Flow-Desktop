import { describe, expect, it } from "vitest";

import type { LiveDevice, LiveStatus, Now } from "../api/live";
import { nowOf } from "./now";
import { focusOf, overrideFor, withOverrides } from "./optimistic";

const playing: Now = { ...nowOf(null), video: "v", state: "playing", pos: 10_000, dur: 60_000, vol: 50, queue: ["v"] };
const phone: LiveDevice = { kind: "phone", can: ["play", "remote"], now: playing, nowAtMs: 1000 };
const status = (device: LiveDevice): LiveStatus => ({ available: true, online: ["phone"], devices: { phone: device } });

describe("overrideFor", () => {
  it("pauses where the video is now, and sets a volume or a position", () => {
    expect(overrideFor(phone, "pause", {}, 3000)?.now).toMatchObject({ state: "paused", pos: 12_000 });
    expect(overrideFor(phone, "seek", { pos: 5000 }, 3000)?.now.pos).toBe(5000);
    expect(overrideFor(phone, "volume", { vol: 80 }, 3000)?.now.vol).toBe(80);
    expect(overrideFor(phone, "next", {}, 3000)).toBeNull();
  });
});

describe("withOverrides", () => {
  const paused = overrideFor(phone, "pause", {}, 3000)!;
  it("shows the command's effect until the device's next now", () => {
    const shown = withOverrides(status(phone), { phone: paused });
    expect(shown.status?.devices.phone?.now?.state).toBe("paused");
    expect(Object.keys(shown.overrides)).toEqual(["phone"]);
  });
  it("lets a later now replace it", () => {
    const later = { ...phone, now: { ...playing, state: "playing" as const }, nowAtMs: 4000 };
    const shown = withOverrides(status(later), { phone: paused });
    expect(shown.status?.devices.phone?.now?.state).toBe("playing");
    expect(shown.overrides).toEqual({});
  });
});

describe("focusOf", () => {
  it("keeps showing a device that was playing once it pauses", () => {
    const pausedPhone = { ...phone, now: { ...playing, state: "paused" as const } };
    expect(focusOf(status(phone), null)).toBe("phone");
    expect(focusOf(status(pausedPhone), "phone")).toBe("phone");
    expect(focusOf(status(pausedPhone), null)).toBeNull();
    expect(focusOf({ ...status(pausedPhone), online: [] }, "phone")).toBeNull();
  });
});
