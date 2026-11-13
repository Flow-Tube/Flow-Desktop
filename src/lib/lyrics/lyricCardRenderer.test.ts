import { beforeAll, describe, expect, it, vi } from "vitest";

import { CARD_DESIGN_WIDTH, drawLyricCard, layoutLyricCard, lyricFontSize, type LyricCardData } from "./lyricCardRenderer";
import type { CardStyle } from "./palette";

const measure = (text: string) => text.length * 10;
const measurer = { width: (text: string) => measure(text), extent: (_font: string, size: number) => ({ ascent: size * 0.8, descent: size * 0.2 }) };
const layout = (card: LyricCardData) => layoutLyricCard(card, measurer, "Inter");

const data: LyricCardData = { lines: ["First lyric line", "Second lyric line"], title: "Song", artist: "Artist" };
const style: CardStyle = { id: "surface", ground: { r: 20, g: 20, b: 20 }, ink: { r: 255, g: 255, b: 255 } };

describe("layoutLyricCard", () => {
  it("puts every lyric between the divider and the logo, and grows with the lyrics", () => {
    const card = layout(data);
    for (const line of card.lines) {
      expect(line.y).toBeGreaterThan(card.dividerY);
      expect(line.y + card.lineHeight).toBeLessThanOrEqual(card.footerY);
    }
    expect(card.footerY).toBeLessThan(card.height);
    const longer = layout({ ...data, lines: [...data.lines, "Third", "Fourth", "Fifth"] });
    expect(longer.height).toBeGreaterThan(card.height);
    expect(longer.fontSize).toBe(lyricFontSize(5));
  });

  it("breaks long lines between words, inside the card", () => {
    const card = layout({ ...data, lines: ["This is a much longer lyric line that has to wrap inside the card"] });
    expect(card.lines.length).toBeGreaterThan(1);
    for (const line of card.lines) expect(measure(line.text)).toBeLessThanOrEqual(CARD_DESIGN_WIDTH - 48);
  });

  it("breaks a line with no spaces, as Japanese is written, inside the card", () => {
    const text = "君の名前を呼んでいる夜の向こうで待っている僕らはまだ知らない";
    const card = layout({ ...data, lines: [text] });
    expect(card.lines.length).toBeGreaterThan(1);
    expect(card.lines.map((line) => line.text).join("")).toBe(text);
    for (const line of card.lines) expect(measure(line.text)).toBeLessThanOrEqual(CARD_DESIGN_WIDTH - 48);
  });

  it("marks a right-to-left line", () => {
    expect(layout({ ...data, lines: ["أحبك يا قمر"] }).lines[0]).toMatchObject({ rtl: true });
  });
});

describe("drawLyricCard", () => {
  beforeAll(() => {
    vi.stubGlobal("Path2D", class {});
  });

  const fakeContext = () => {
    const texts: { text: string; x: number; align: string; direction: string }[] = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), clip: vi.fn(), roundRect: vi.fn(), clearRect: vi.fn(),
      fillRect: vi.fn(), fill: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: (text: string) => ({ width: measure(text) }),
      fillText(text: string, x: number) {
        texts.push({ text, x, align: this.textAlign, direction: this.direction });
      },
      textAlign: "left", direction: "ltr", fillStyle: "", font: "", textBaseline: "top",
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
  };

  it.each([
    ["left", 24],
    ["center", 170],
    ["right", 316],
  ] as const)("anchors the lyrics %s", (align, x) => {
    const { ctx, texts } = fakeContext();
    drawLyricCard(ctx, data, { style, align, fontFamily: "Inter" }, layout(data), null);
    expect(texts.find((entry) => entry.text === "First lyric line")).toMatchObject({ x, align });
    expect(texts.map((entry) => entry.text)).toEqual(expect.arrayContaining(["Song", "Artist", "Flow"]));
  });

  it("shapes a right-to-left lyric right to left", () => {
    const { ctx, texts } = fakeContext();
    const arabic = { ...data, lines: ["أحبك يا قمر"] };
    drawLyricCard(ctx, arabic, { style, align: "right", fontFamily: "Inter" }, layout(arabic), null);
    expect(texts.find((entry) => entry.text === "أحبك يا قمر")).toMatchObject({ direction: "rtl", align: "right" });
  });
});
