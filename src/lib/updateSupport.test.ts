import { describe, expect, it } from "vitest";

import { parseUpdateSupport, updateBlockedStringKey } from "./updateSupport";

describe("parseUpdateSupport", () => {
  it("keeps a blocked install with a known reason", () => {
    expect(parseUpdateSupport({ supported: false, reason: "package-manager" })).toEqual({
      supported: false,
      reason: "package-manager",
    });
  });

  it("treats a supported install as supported", () => {
    expect(parseUpdateSupport({ supported: true, reason: null })).toEqual({
      supported: true,
      reason: null,
    });
  });

  it("falls back to supported on malformed payloads", () => {
    for (const payload of [null, "flatpak", 3, {}, { supported: false }, { supported: false, reason: "snap" }]) {
      expect(parseUpdateSupport(payload)).toEqual({ supported: true, reason: null });
    }
  });
});

describe("updateBlockedStringKey", () => {
  it("names who manages updates", () => {
    expect(updateBlockedStringKey("flatpak")).toBe("settings_updates_managed_flatpak");
    expect(updateBlockedStringKey("package-manager")).toBe("settings_updates_managed_package_manager");
    expect(updateBlockedStringKey("unbundled")).toBe("settings_updates_unbundled");
  });
});
