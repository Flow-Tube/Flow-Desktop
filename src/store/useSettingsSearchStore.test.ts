import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsSearchStore } from "./useSettingsSearchStore";

describe("useSettingsSearchStore", () => {
  beforeEach(() => {
    useSettingsSearchStore.getState().clearQuery();
  });

  it("initializes with an empty query", () => {
    expect(useSettingsSearchStore.getState().query).toBe("");
  });

  it("updates query via setQuery", () => {
    useSettingsSearchStore.getState().setQuery("ambient");
    expect(useSettingsSearchStore.getState().query).toBe("ambient");
  });

  it("clears query via clearQuery", () => {
    useSettingsSearchStore.getState().setQuery("ambient");
    expect(useSettingsSearchStore.getState().query).toBe("ambient");

    useSettingsSearchStore.getState().clearQuery();
    expect(useSettingsSearchStore.getState().query).toBe("");
  });
});
