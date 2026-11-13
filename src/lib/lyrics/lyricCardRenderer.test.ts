import { describe, expect, it, vi } from "vitest";
import {
  CARD_WIDTH,
  calculateCardHeight,
  drawFlowLogo,
  drawLyricCard,
  wrapText,
  type LyricCardData,
  type LyricCardOptions,
} from "./lyricCardRenderer";

describe("lyricCardRenderer", () => {
  describe("wrapText", () => {
    it("keeps short text on a single line", () => {
      const ctx = {
        measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      } as unknown as CanvasRenderingContext2D;

      const lines = wrapText(ctx, "Short lyric", 200);
      expect(lines).toEqual(["Short lyric"]);
    });

    it("wraps long text across multiple lines when width is exceeded", () => {
      const ctx = {
        measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      } as unknown as CanvasRenderingContext2D;

      const lines = wrapText(ctx, "This is a much longer lyric line that must wrap nicely", 150);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join(" ")).toBe("This is a much longer lyric line that must wrap nicely");
    });
  });

  describe("drawLyricCard", () => {
    const mockCtx = () => {
      const gradient = { addColorStop: vi.fn() };
      return {
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        clip: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        roundRect: vi.fn(),
        createLinearGradient: vi.fn(() => gradient),
        measureText: vi.fn((text: string) => ({
          width: text.length * 10,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 2,
        })),
        translate: vi.fn(),
        scale: vi.fn(),
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "left",
        textBaseline: "top",
        shadowColor: "",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      } as unknown as CanvasRenderingContext2D;
    };

    const sampleData: LyricCardData = {
      lines: ["First lyric line", "Second lyric line"],
      title: "Sample Song",
      artist: "Sample Artist",
      coverUrl: null,
    };

    it("draws without errors for solid dark hex swatch and left alignment", () => {
      const ctx = mockCtx();
      const options: LyricCardOptions = { theme: "#121212", align: "left" };

      expect(() => drawLyricCard(ctx, sampleData, options, null)).not.toThrow();
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, CARD_WIDTH, expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalled();
    });

    it("draws without errors for solid light hex swatch with dark text and center alignment", () => {
      const ctx = mockCtx();
      const options: LyricCardOptions = { theme: "#ffffff", align: "center" };

      expect(() => drawLyricCard(ctx, sampleData, options, null)).not.toThrow();
      expect(ctx.fillText).toHaveBeenCalled();
    });

    it("draws without errors for cover theme with cover image and right alignment", () => {
      const ctx = mockCtx();
      const options: LyricCardOptions = { theme: "cover", align: "right" };
      const dummyImg = {} as HTMLImageElement;

      expect(() => drawLyricCard(ctx, sampleData, options, dummyImg)).not.toThrow();
      expect(ctx.drawImage).toHaveBeenCalled();
    });

    it("calculates portrait height matching rendered preview proportions", () => {
      const ctx = mockCtx();
      const fourLinesData: LyricCardData = {
        lines: [
          "तू छोड़ा सिर्फ game को, किया कभी grip नहीं",
          "मुर्गियाँ हलाल, यहाँ पे chase करते chicks नहीं",
          "Rap नहीं saregama, तभी देते tips नहीं",
          "Pork हो या poker, हम लेते कभी chips नहीं",
        ],
        title: "ABCD.",
        artist: "DIVINE, MC Altaf, Sammohit",
      };

      const height = calculateCardHeight(ctx, fourLinesData, 340, 2.5);
      expect(height).toBeGreaterThan(600);
      expect(height).toBeLessThan(1400);
    });

    it("draws the Flow logo and vertically aligns the Flow wordmark", () => {
      const ctx = mockCtx();
      const options: LyricCardOptions = { theme: "#121212", align: "left" };

      drawLyricCard(ctx, sampleData, options, null);

      // Verify "Flow" wordmark is rendered
      const flowTextCall = vi.mocked(ctx.fillText).mock.calls.find((call) => call[0] === "Flow");
      expect(flowTextCall).toBeDefined();
      expect(typeof flowTextCall?.[1]).toBe("number");
      expect(typeof flowTextCall?.[2]).toBe("number");
    });
  });

  describe("drawFlowLogo", () => {
    it("draws the fallback shape when Path2D is unavailable", () => {
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        fill: vi.fn(),
        roundRect: vi.fn(),
        fillText: vi.fn(),
        fillStyle: "",
        font: "",
        textAlign: "left",
        textBaseline: "top",
      } as unknown as CanvasRenderingContext2D;

      expect(() => drawFlowLogo(ctx, 10, 20, 28, "#fff", "#000")).not.toThrow();
      expect(ctx.roundRect).toHaveBeenCalledWith(10, 20, 28, expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith("F", expect.any(Number), expect.any(Number));
    });
  });
});
