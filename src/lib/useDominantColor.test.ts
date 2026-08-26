import { describe, expect, it } from "vitest";

import { extractDominantColorFromImage } from "./useDominantColor";

/**
 * jsdom has no canvas backend, so these cover the readiness gate that runs
 * *before* any drawing — which is the whole point: a broken image must never
 * reach `drawImage`.
 */
function imageStub(overrides: Partial<HTMLImageElement>): HTMLImageElement {
  return {
    complete: true,
    naturalWidth: 320,
    naturalHeight: 180,
    ...overrides,
  } as HTMLImageElement;
}

describe("extractDominantColorFromImage", () => {
  /*
    `complete` is true for a broken image too — the fetch finished, it just
    finished by failing. Drawing one throws InvalidStateError, and the caller
    runs on mouseenter, so a dead thumbnail became one uncaught throw per card
    under a sweeping cursor.
  */
  it("returns null for a broken image that still reports complete", () => {
    const broken = imageStub({ naturalWidth: 0, naturalHeight: 0 });

    expect(extractDominantColorFromImage(broken)).toBeNull();
  });

  it("returns null for an image that has not finished loading", () => {
    expect(extractDominantColorFromImage(imageStub({ complete: false }))).toBeNull();
  });

  it("returns null rather than throwing when the canvas is unavailable", () => {
    expect(() => extractDominantColorFromImage(imageStub({}))).not.toThrow();
  });
});
