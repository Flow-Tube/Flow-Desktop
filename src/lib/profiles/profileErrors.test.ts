import { describe, expect, it } from "vitest";
import { getString } from "../i18n/index";
import { profileErrorMessage } from "./profileErrors";

describe("profileErrorMessage", () => {
  it("names the reason a switch was refused", () => {
    expect(profileErrorMessage({ kind: "profileSwitchRefused", message: "syncRunning" }, "profiles_switch_failed")).toBe(
      getString("profiles_switch_refused_sync"),
    );
  });

  it("explains a rejected name", () => {
    expect(profileErrorMessage({ kind: "profileName", message: "taken" }, "profiles_create_failed")).toBe(
      getString("profiles_name_taken"),
    );
  });

  it("falls back for anything else", () => {
    expect(profileErrorMessage(new Error("boom"), "profiles_switch_failed")).toBe(getString("profiles_switch_failed"));
  });
});
