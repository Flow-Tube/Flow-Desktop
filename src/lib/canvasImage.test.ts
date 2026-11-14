import { describe, expect, it } from "vitest";

import { blobToBase64, fitText } from "./canvasImage";

describe("fitText", () => {
  const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) } as unknown as CanvasRenderingContext2D;

  it("leaves text that fits alone and shortens the rest", () => {
    expect(fitText(ctx, "short", 100)).toBe("short");
    expect(fitText(ctx, "a much longer name", 100)).toBe("a much lo…");
  });
});

describe("blobToBase64", () => {
  it("gives the bytes without the data URL's prefix", async () => {
    await expect(blobToBase64(new Blob(["hi"], { type: "image/png" }))).resolves.toBe("aGk=");
  });
});
