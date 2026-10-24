import { describe, expect, it } from "vitest";

import { DEFAULT_PROVIDER_ORDER, resolveProviderOrder, serializeProviderOrder } from "./providerOrder";

describe("lyrics provider order", () => {
  it("uses the default order when nothing is saved", () => {
    expect(resolveProviderOrder("")).toEqual(DEFAULT_PROVIDER_ORDER);
    expect(resolveProviderOrder(null)).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it("keeps a full saved order as it is", () => {
    const saved = [...DEFAULT_PROVIDER_ORDER].reverse();
    expect(resolveProviderOrder(saved.join(","))).toEqual(saved);
  });

  it("inserts a provider the saved order lacks right after its default predecessor", () => {
    const saved = ["LyricsPlus", "BetterLyrics", "SimpMusic", "KuGou", "LrcLib", "YouTube"];
    const resolved = resolveProviderOrder(saved.join(","));
    expect(resolved.indexOf("Paxsenix")).toBe(resolved.indexOf("KuGou") + 1);
    expect(resolved.filter((name) => saved.includes(name))).toEqual(saved);
  });

  it("puts a missing first provider at the top", () => {
    const saved = DEFAULT_PROVIDER_ORDER.slice(1);
    expect(resolveProviderOrder(saved.join(","))).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it("drops unknown and repeated names", () => {
    const resolved = resolveProviderOrder(`Gone, KuGou,KuGou,${DEFAULT_PROVIDER_ORDER.join(",")}`);
    expect(resolved[0]).toBe("KuGou");
    expect([...resolved].sort()).toEqual([...DEFAULT_PROVIDER_ORDER].sort());
  });

  it("drops the removed YouTubeSubtitle stub from an old saved order", () => {
    expect(resolveProviderOrder("YouTubeSubtitle,YouTube")).not.toContain("YouTubeSubtitle");
  });

  it("serializes known names once", () => {
    expect(serializeProviderOrder(["KuGou", "Gone", "KuGou", "LrcLib"])).toBe("KuGou,LrcLib");
  });
});
