import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  CARD_DESIGN_WIDTH,
  drawLyricCard,
  largestFittingScale,
  lyricsCopyText,
  planLyricCard,
  type LyricCardData,
  type LyricCardLook,
} from "./lyricCardRenderer";

const measure = (text: string) => text.length * 10;
const measurer = { width: (text: string) => measure(text), extent: (_font: string, size: number) => ({ ascent: size * 0.8, descent: size * 0.2 }) };

const data: LyricCardData = { lines: ["First lyric line", "Second lyric line"], title: "Song", artist: "Artist" };
const look: LyricCardLook = {
  style: { id: "surface", ground: { r: 20, g: 20, b: 20 }, ink: { r: 255, g: 255, b: 255 } },
  align: "left",
  layout: "classic",
  aspect: "fit",
  frame: "square",
  backdrop: { r: 200, g: 100, b: 50 },
  fontFamily: "Inter",
};
const plan = (overrides: Partial<LyricCardLook> = {}, card: LyricCardData = data) => planLyricCard(card, { ...look, ...overrides }, measurer);

describe("planLyricCard", () => {
  it.each(["classic", "poster", "shape"] as const)("keeps every %s line inside the card", (layout) => {
    const card = plan({ layout });
    for (const row of card.lines.rows) {
      expect(row.y).toBeGreaterThan(card.card.y);
      expect(row.y + card.lines.lineHeight).toBeLessThanOrEqual(card.card.y + card.card.height);
    }
  });

  it("sizes the image to the content, to a square or to a 9:16 story", () => {
    expect(plan({ aspect: "square" }).height).toBe(CARD_DESIGN_WIDTH);
    expect(plan({ aspect: "story" }).height).toBeCloseTo((CARD_DESIGN_WIDTH * 16) / 9);
    const longer = plan({}, { ...data, lines: [...data.lines, "Third", "Fourth", "Fifth"] });
    expect(longer.height).toBeGreaterThan(plan().height);
  });

  it("grows a few lines to fill a story and shrinks many to fit a square", () => {
    expect(plan({ aspect: "story" }).lines.size).toBeGreaterThan(24);
    const many = { ...data, lines: Array.from({ length: 5 }, () => "A long lyric line that wraps over two rows") };
    expect(plan({ aspect: "square" }, many).lines.size).toBeLessThan(24);
  });

  it("insets a framed card on its margin, rounds it, and squares the square frame", () => {
    expect(plan({ frame: "backdrop" }).card).toMatchObject({ x: 24, y: 24, width: CARD_DESIGN_WIDTH - 48, radius: 28 });
    expect(plan({ frame: "clear" }).card.radius).toBe(28);
    expect(plan({ frame: "square" }).card.radius).toBe(0);
  });

  it("breaks a line with no spaces, as Japanese is written, inside the card", () => {
    const text = "君の名前を呼んでいる夜の向こうで待っている僕らはまだ知らないそしてまた明日も歌う";
    const card = plan({}, { ...data, lines: [text] });
    expect(card.lines.rows.length).toBeGreaterThan(1);
    expect(card.lines.rows.map((row) => row.text).join("")).toBe(text);
    for (const row of card.lines.rows) expect(measure(row.text)).toBeLessThanOrEqual(card.lines.width);
  });
});

describe("largestFittingScale", () => {
  it("finds the largest scale that fits, within the bounds", () => {
    expect(largestFittingScale(0.6, 1.6, () => true)).toBe(1.6);
    expect(largestFittingScale(0.6, 1.6, () => false)).toBe(0.6);
    expect(largestFittingScale(0.6, 1.6, (scale) => scale <= 1.2)).toBeCloseTo(1.2, 2);
  });
});

describe("drawLyricCard", () => {
  beforeAll(() => {
    vi.stubGlobal("Path2D", class {});
  });

  const fakeContext = () => {
    const texts: { text: string; x: number; align: string; direction: string }[] = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), clip: vi.fn(),
      roundRect: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fill: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(),
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
    ["center", 180],
    ["right", 336],
  ] as const)("anchors the lyrics %s", (align, x) => {
    const { ctx, texts } = fakeContext();
    drawLyricCard(ctx, data, { ...look, align }, plan({ align }), null);
    expect(texts.find((entry) => entry.text === "First lyric line")).toMatchObject({ x, align });
    expect(texts.map((entry) => entry.text)).toEqual(expect.arrayContaining(["Song", "Artist", "Flow"]));
  });

  it("puts only the badge on the poster, beside the song", () => {
    const { ctx, texts } = fakeContext();
    drawLyricCard(ctx, data, { ...look, layout: "poster" }, plan({ layout: "poster" }), null);
    expect(texts.map((entry) => entry.text)).not.toContain("Flow");
  });

  it("shapes a right-to-left lyric right to left", () => {
    const { ctx, texts } = fakeContext();
    const arabic = { ...data, lines: ["أحبك يا قمر"] };
    drawLyricCard(ctx, arabic, { ...look, align: "right" }, plan({ align: "right" }, arabic), null);
    expect(texts.find((entry) => entry.text === "أحبك يا قمر")).toMatchObject({ direction: "rtl", align: "right" });
  });

  it("crops the background mesh with cover aspect ratio without distortion", () => {
    const { ctx } = fakeContext();
    const mesh = new Uint8ClampedArray(64 * 64 * 4);
    const storyPlan = plan({ aspect: "story" });
    drawLyricCard(ctx, data, { ...look, aspect: "story", style: { ...look.style, mesh } }, storyPlan, null);

    // Verify drawImage was called for the mesh with cropped source coordinates
    const meshCall = vi.mocked(ctx.drawImage).mock.calls.find((call) => call.length === 9);
    expect(meshCall).toBeDefined();
    if (meshCall) {
      const [, sx, sy, sw, sh, , , dw, dh] = meshCall;
      // In a 9:16 card, source width is cropped (sx > 0, sy === 0)
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBe(0);
      expect(sh).toBe(64);
      // Source aspect ratio matches destination aspect ratio exactly
      expect((sw as number) / (sh as number)).toBeCloseTo((dw as number) / (dh as number), 2);
    }
  });
});

describe("lyricsCopyText", () => {
  it("puts a song and artist credit under the lines, as Android does", () => {
    expect(lyricsCopyText(["One", "Two"], "Song", "Artist")).toBe("One\nTwo\n\nSong, Artist");
    expect(lyricsCopyText(["One"], "", "")).toBe("One");
  });
});
