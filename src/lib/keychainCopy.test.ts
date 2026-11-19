import { describe, expect, it } from "vitest";

import { getString } from "./i18n/index";
import { keychainCopy } from "./keychainCopy";

const body = (...args: Parameters<typeof keychainCopy>) => getString(keychainCopy(...args).body);

describe("keychainCopy", () => {
  it("names macOS only on macOS", () => {
    expect(body("locked", "macos")).toContain("macOS");
    expect(body("waiting", "macos")).toContain("macOS");
    for (const problem of ["waiting", "locked", "unavailable", "failed"] as const) {
      expect(body(problem, "linux")).not.toContain("macOS");
      expect(body(problem, "windows")).not.toContain("macOS");
    }
  });

  it("tells Linux which keychains Flow can use", () => {
    expect(body("unavailable", "linux")).toContain("KDE Wallet");
    expect(body("locked", "linux")).toContain("GNOME Keyring");
    expect(body("unavailable", "windows")).not.toContain("KDE Wallet");
  });

  it("titles a missing keychain differently from one to allow", () => {
    expect(keychainCopy("unavailable", "linux").title).toBe("linked_keychain_title_missing");
    expect(keychainCopy("locked", "linux").title).toBe("linked_keychain_title");
  });
});
