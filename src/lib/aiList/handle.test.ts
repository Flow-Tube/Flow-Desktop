import { describe, expect, it } from "vitest";
import { normalizeAiHandle } from "./handle";

// The pipeline's normalize-vectors.json, shared with Flow for Android and the backend.
const VECTORS: [string, string | null][] = [
  ["@DPCartoon%C3%80i-v6k", "dpcartoonài-v6k"],
  ["@HFY_en_Español", "hfy_en_español"],
  ["@소소한작업실-z8d", "소소한작업실-z8d"],
  ["@ELTÍOFRONTAL", "eltíofrontal"],
  ["/@LinusTechTips/shorts", "linustechtips"],
  ["@M%C3%BAsicaB%C3%ADblicaInstrumental", "músicabíblicainstrumental"],
  [" @Some.Channel_1 ", "some.channel_1"],
  ["@Aiomo%E3%81%82%E3%81%84%E3%81%8A%E3%82%82", "aiomoあいおも"],
  ["@Bad%ZZname", null],
];

describe("normalizeAiHandle", () => {
  it.each(VECTORS)("normalizes %s exactly as the pipeline does", (input, expected) => {
    expect(normalizeAiHandle(input)).toBe(expected);
  });

  it("counts length in code points", () => {
    const sixtyFour = `${"a".repeat(63)}😀`;
    expect(normalizeAiHandle(`@${sixtyFour}`)).toBe(sixtyFour);
    expect(normalizeAiHandle(`@a${sixtyFour}`)).toBeNull();
  });

  it("trims and rejects JavaScript whitespace only", () => {
    expect(normalizeAiHandle(" @Name﻿")).toBe("name");
    expect(normalizeAiHandle("@Na me")).toBeNull();
    expect(normalizeAiHandle("@Na\u0085me")).toBe("na\u0085me");
  });

  it("keeps a plus sign and refuses a broken UTF-8 sequence", () => {
    expect(normalizeAiHandle("@a+b%2Bc")).toBe("a+b+c");
    expect(normalizeAiHandle("@caf%C3")).toBeNull();
    expect(normalizeAiHandle("@caf%C3%A9")).toBe("café");
  });

  it("reads the handle out of a channel URL", () => {
    expect(normalizeAiHandle("https://www.youtube.com/@SomeOne/videos?x=1")).toBe("someone");
    expect(normalizeAiHandle(null)).toBeNull();
  });
});
