import { describe, expect, it } from "vitest";

import { METADATA_CHECK_COOLDOWN_MS, pruneChecks } from "./playlistMetadataChecks";

describe("pruneChecks", () => {
  it("drops checks past their cooldown and keeps the rest", () => {
    const now = 10 * METADATA_CHECK_COOLDOWN_MS;
    const checks = new Map([
      ["fresh", now - 1000],
      ["expired", now - METADATA_CHECK_COOLDOWN_MS - 1],
    ]);
    expect([...pruneChecks(checks, now).keys()]).toEqual(["fresh"]);
  });
});
