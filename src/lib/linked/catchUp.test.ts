import { describe, expect, it, vi } from "vitest";
import { settleWithin } from "./catchUp";

describe("settleWithin", () => {
  it("settles when the work does, even when it fails", async () => {
    await expect(settleWithin(Promise.resolve(1), 1_000)).resolves.toBeUndefined();
    await expect(settleWithin(Promise.reject(new Error("offline")), 1_000)).resolves.toBeUndefined();
  });

  it("stops waiting at the limit", async () => {
    vi.useFakeTimers();
    try {
      const waited = settleWithin(new Promise(() => {}), 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(waited).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
