import { describe, expect, it } from "vitest";

import type { LinkedDevice } from "../api/linked";
import { deviceLabels, shortIdsForSharedNames } from "./deviceNames";

const device = (id: string, name: string): LinkedDevice => ({
  id,
  name,
  platform: "windows",
  thisDevice: false,
  setRecoveryKey: false,
  nearby: false,
});

describe("shortIdsForSharedNames", () => {
  it("gives two devices with one name the start of their ids (#2184)", () => {
    const ids = shortIdsForSharedNames([
      device("3fa1c0de", "Flow Desktop (Windows)"),
      device("9c07beef", "flow desktop (windows) "),
      device("aaaa0000", "Pixel 9"),
    ]);

    expect(Object.fromEntries(ids)).toEqual({ "3fa1c0de": "3fa1", "9c07beef": "9c07", aaaa0000: null });
  });

  it("grows ids that start alike until they differ", () => {
    const ids = shortIdsForSharedNames([device("3fa1c0de", "Desktop"), device("3fa1beef", "Desktop")]);

    expect([...ids.values()]).toEqual(["3fa1c0de", "3fa1beef"]);
  });

  it("stops at 16 characters", () => {
    const start = "0123456789abcdef";
    const ids = shortIdsForSharedNames([device(`${start}aa`, "Desktop"), device(`${start}bb`, "Desktop")]);

    expect([...ids.values()]).toEqual([start, start]);
  });
});

describe("deviceLabels", () => {
  it("adds the id only where a name is shared", () => {
    const labels = deviceLabels([
      device("3fa1c0de", "Flow Desktop (Windows)"),
      device("9c07beef", "Flow Desktop (Windows)"),
      device("aaaa0000", "Pixel 9"),
    ]);

    expect(Object.fromEntries(labels)).toEqual({
      "3fa1c0de": "Flow Desktop (Windows) · 3fa1",
      "9c07beef": "Flow Desktop (Windows) · 9c07",
      aaaa0000: "Pixel 9",
    });
  });
});
