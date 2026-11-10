import { describe, expect, it } from "vitest";
import { homeReasonLine } from "./homeOrigin";

describe("homeReasonLine", () => {
  it("speaks only for channels the viewer keeps watching", () => {
    expect(homeReasonLine({ kind: "channelMemory" })).toBe("From a channel you watch");
    expect(homeReasonLine({ kind: "subscription" })).toBeUndefined();
    expect(homeReasonLine(undefined)).toBeUndefined();
  });
});
