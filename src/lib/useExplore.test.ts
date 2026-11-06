import { describe, expect, it } from "vitest";
import { BackendApiError } from "./api/errors";
import { exploreErrorKey } from "./useExplore";

describe("exploreErrorKey", () => {
  it("names YouTube's limit apart from any other failure", () => {
    expect(exploreErrorKey(new BackendApiError("limited", "rateLimited", null))).toBe("explore_rate_limited");
    expect(exploreErrorKey({ message: "limited", kind: "rateLimited" })).toBe("explore_rate_limited");
    expect(exploreErrorKey(new BackendApiError("down", "network", null))).toBe("explore_load_error");
  });
});
