import { describe, expect, it } from "vitest";

import { getEnabledProviders, isProviderEnabled, parseProviderEnabledStates, serializeProviderEnabledStates } from "./registry";

describe("lyrics source defaults", () => {
  it("leaves YouTube captions off until the listener turns it on", () => {
    expect(isProviderEnabled({}, "YouTubeSubtitle")).toBe(false);
    expect(isProviderEnabled({}, "LrcLib")).toBe(true);
    expect(getEnabledProviders("", {}).map((p) => p.name)).not.toContain("YouTubeSubtitle");
    expect(getEnabledProviders("", { YouTubeSubtitle: true }).map((p) => p.name)).toContain("YouTubeSubtitle");
  });

  it("saves the default off state with the rest, so it stays off", () => {
    const saved = parseProviderEnabledStates(serializeProviderEnabledStates({ LrcLib: false }));
    expect(saved.YouTubeSubtitle).toBe(false);
    expect(saved.LrcLib).toBe(false);
    expect(saved.KuGou).toBe(true);
  });
});
