import { describe, expect, it } from "vitest";

import { buildKaraokeGeometry, drawKaraoke, type KaraokeFrame, type KaraokePaint } from "./karaoke";
import { layoutText, type TextMeasurer } from "./textLayout";
import { wordCharRanges } from "./timing";

const fixedMeasurer: TextMeasurer = {
  width: (value) => Array.from(value).length * 10,
  extent: () => ({ ascent: 16, descent: 4 }),
};

/** Records what a 2D context is asked to draw. */
function recordingContext() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "" as unknown,
    shadowColor: "",
    shadowBlur: 0,
    direction: "ltr",
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => {},
    rect: (x: number, _y: number, w: number) => calls.push(`clip ${x}..${x + w}`),
    clip: () => {},
    translate: (x: number) => calls.push(`translate ${x}`),
    fillText: (text: string, x: number, y: number) => calls.push(`fill ${String(ctx.fillStyle)} "${text}" ${x} ${y}`),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const paint: KaraokePaint = {
  sung: "SUNG",
  unsung: "UNSUNG",
  forward: "FORWARD",
  backward: "BACKWARD",
  glowColors: Array.from({ length: 8 }, (_, i) => `glow${i}`),
  glowBlurs: Array.from({ length: 8 }, (_, i) => i),
};

const style = { size: 20, weight: 700, italic: false, family: "Inter", lineSpacing: 1.3 };
const words = [
  { text: "hold", startTime: 0, endTime: 400 },
  { text: "me", startTime: 400, endTime: 2000 },
];
const text = "hold me";
const block = layoutText(text, style, 1000, fixedMeasurer);
const geometry = buildKaraokeGeometry(text, block, 200, "left", words, wordCharRanges(text, words, false), fixedMeasurer);
const frame = (patch: Partial<KaraokeFrame>): KaraokeFrame => ({
  position: null,
  liftClock: null,
  lift: 0,
  glow: true,
  overscan: 20,
  height: block.height,
  ...patch,
});

describe("karaoke drawing", () => {
  it("draws an idle line once, unsung, without cells", () => {
    const { ctx, calls } = recordingContext();
    drawKaraoke(ctx, geometry, paint, frame({}));
    expect(calls).toEqual([`fill UNSUNG "hold me" 0 16`]);
  });

  it("fills sung words, slides the front through the word being sung, and leaves the rest unsung", () => {
    const { ctx, calls } = recordingContext();
    drawKaraoke(ctx, geometry, paint, frame({ position: 1200, liftClock: 1200, glow: false }));
    const fills = calls.filter((c) => c.startsWith("fill"));
    expect(fills[0]).toBe(`fill SUNG "hold me" 0 16`);
    expect(fills[1]).toMatch(/^fill FORWARD "hold me" -/);
    // "me" covers 50..70; half sung puts the front at 60.
    expect(calls).toContain("translate 60");
  });

  it("lights a held note's glow only while it is being sung", () => {
    const sungNow = recordingContext();
    drawKaraoke(sungNow.ctx, geometry, paint, frame({ position: 1200, liftClock: 1200 }));
    expect(sungNow.calls.some((c) => c.includes(`"me" 50`))).toBe(true);
    const shortWord = recordingContext();
    drawKaraoke(shortWord.ctx, geometry, paint, frame({ position: 200, liftClock: 200 }));
    expect(shortWord.calls.some((c) => c.includes(`"hold" `))).toBe(false);
  });

  it("lifts a word as it starts", () => {
    const { ctx, calls } = recordingContext();
    drawKaraoke(ctx, geometry, paint, frame({ position: 600, liftClock: 600, lift: 1, glow: false }));
    const meFill = calls.filter((c) => c.startsWith("fill"))[1]!;
    const baseline = Number(meFill.split(" ").pop());
    expect(baseline).toBeLessThan(16);
  });
});
