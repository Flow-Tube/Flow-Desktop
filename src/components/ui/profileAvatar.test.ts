import { describe, expect, it } from "vitest";
import { profileColorClasses, profileInitial } from "./ProfileAvatar";

describe("profile avatar", () => {
  it("uses the first character as a person reads it", () => {
    expect(profileInitial("  study")).toBe("S");
    expect(profileInitial("éa")).toBe("É");
    expect(profileInitial("👩‍💻 Work")).toBe("👩‍💻");
    expect(profileInitial("")).toBe("");
  });

  it("falls back to the theme accent for a blank or unknown colour", () => {
    expect(profileColorClasses("teal")).toContain("bg-profile-teal-container");
    expect(profileColorClasses("")).toContain("var(--color-primary)");
    expect(profileColorClasses("chartreuse")).toBe(profileColorClasses(""));
  });
});
