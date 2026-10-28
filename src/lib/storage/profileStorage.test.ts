import { afterEach, describe, expect, it } from "vitest";
import { profileStorage, storageKey } from "./profileStorage";

afterEach(() => {
  delete window.__FLOW_PROFILE__;
  localStorage.clear();
});

describe("profileStorage", () => {
  it("keeps Default on today's bare keys", () => {
    window.__FLOW_PROFILE__ = { id: "d", isDefault: true };
    profileStorage.setItem("flow_search_history", "[1]");
    expect(localStorage.getItem("flow_search_history")).toBe("[1]");
  });

  it("falls back to Default when no profile was injected", () => {
    expect(storageKey("flow_theater_mode")).toBe("flow_theater_mode");
  });

  it("prefixes another profile's keys and keeps the two apart", () => {
    localStorage.setItem("flow_search_history", "default");
    window.__FLOW_PROFILE__ = { id: "study", isDefault: false };
    expect(profileStorage.getItem("flow_search_history")).toBeNull();
    profileStorage.setItem("flow_search_history", "study");
    expect(localStorage.getItem("p:study:flow_search_history")).toBe("study");
    expect(localStorage.getItem("flow_search_history")).toBe("default");
    profileStorage.removeItem("flow_search_history");
    expect(localStorage.getItem("p:study:flow_search_history")).toBeNull();
  });

  it("shares device keys between profiles", () => {
    window.__FLOW_PROFILE__ = { id: "study", isDefault: false };
    profileStorage.setItem("flow_boot_theme", "dark", "device");
    expect(localStorage.getItem("flow_boot_theme")).toBe("dark");
  });

  it("lists only the active profile's keys", () => {
    localStorage.setItem("flow_lyrics_a", "1");
    localStorage.setItem("p:study:flow_lyrics_b", "2");
    localStorage.setItem("p:gaming:flow_lyrics_c", "3");
    expect(profileStorage.keys()).toEqual(["flow_lyrics_a"]);
    window.__FLOW_PROFILE__ = { id: "study", isDefault: false };
    expect(profileStorage.keys()).toEqual(["flow_lyrics_b"]);
  });
});
