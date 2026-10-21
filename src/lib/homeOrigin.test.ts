import { describe, expect, it } from "vitest";
import { homeOriginLabel } from "./homeOrigin";

describe("homeOriginLabel", () => {
  it("names the search, the seed and the channels a neighbour sits next to", () => {
    expect(homeOriginLabel({ kind: "search", detail: "drift phonk" })).toBe("From a search for drift phonk");
    expect(homeOriginLabel({ kind: "related" })).toBe("Related to a video you watched");
    expect(homeOriginLabel({ kind: "neighbour", detail: "Alpha|Beta" })).toBe("A channel like Alpha and Beta");
    expect(homeOriginLabel({ kind: "neighbour" })).toBe("A channel like the ones you follow");
  });
});
