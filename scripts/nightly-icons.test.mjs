import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NIGHTLY_ICONS } from "./nightly-icons.mjs";

describe("NIGHTLY_ICONS", () => {
  it("lists files that exist", () => {
    for (const icon of NIGHTLY_ICONS) expect(existsSync(`src-tauri/${icon}`), icon).toBe(true);
  });

  it("covers every kind the stable list bundles", () => {
    const stable = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).bundle.icon;
    const kinds = (icons) => new Set(icons.map((icon) => icon.split(".").pop()));
    expect(kinds(NIGHTLY_ICONS)).toEqual(kinds(stable));
    expect(NIGHTLY_ICONS.every((icon) => icon.startsWith("icons/nightly/"))).toBe(true);
  });
});
