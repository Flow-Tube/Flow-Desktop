import { describe, expect, it } from "vitest";
import { resolveHideWatched } from "./useWatchedFilter";

describe("resolveHideWatched", () => {
  it("follows the synced switch until the surface has its own choice", () => {
    expect(resolveHideWatched("", "true")).toBe(true);
    expect(resolveHideWatched("", "false")).toBe(false);
    expect(resolveHideWatched(undefined, "true")).toBe(true);
  });

  it("lets the surface's choice win either way", () => {
    expect(resolveHideWatched("false", "true")).toBe(false);
    expect(resolveHideWatched("true", "false")).toBe(true);
  });
});
