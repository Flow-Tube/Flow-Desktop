import { describe, expect, it } from "vitest";
import {
  AmbientPipeline,
  DISPLAY_H,
  DISPLAY_W,
  FRAME_CHANGE_THRESHOLD,
  SAMPLE_H,
  SAMPLE_W,
  boxBlurLinear,
  decimateToLinear,
  encodeDark,
  encodeLight,
  linearToSrgb,
  meanAbsDiff,
  smoothingAlpha,
  srgbToLinear,
  step,
} from "./pipeline";
import { parseAmbientIntensity } from "./useAmbientSettings";
import { SETTINGS, SETTING_DEFINITIONS } from "../settings/schema";

const CELLS = DISPLAY_W * DISPLAY_H;

function solidFrame(r: number, g: number, b: number): Uint8ClampedArray {
  const frame = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = r;
    frame[i + 1] = g;
    frame[i + 2] = b;
    frame[i + 3] = 255;
  }
  return frame;
}

function solidGrid(r: number, g: number, b: number): Float32Array {
  const grid = new Float32Array(CELLS * 3);
  for (let i = 0; i < grid.length; i += 3) {
    grid[i] = r;
    grid[i + 1] = g;
    grid[i + 2] = b;
  }
  return grid;
}

describe("ambient pipeline, matching Android", () => {
  it("round-trips every sRGB byte through linear light", () => {
    for (let byte = 0; byte < 256; byte += 1) {
      expect(linearToSrgb(srgbToLinear(byte))).toBe(byte);
    }
  });

  it("averages in linear light, not in sRGB bytes", () => {
    const frame = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
    for (let y = 0; y < SAMPLE_H; y += 1) {
      for (let x = 0; x < SAMPLE_W; x += 1) {
        const value = x % 2 === 0 ? 255 : 0;
        const o = (y * SAMPLE_W + x) * 4;
        frame[o] = value;
        frame[o + 1] = value;
        frame[o + 2] = value;
      }
    }
    const grid = new Float32Array(CELLS * 3);
    decimateToLinear(frame, grid);
    // Three columns of 3x3 alternate 2:1, so the first cell holds 6 white of 9.
    expect(grid[0]).toBeCloseTo(6 / 9, 5);
  });

  it("blurs without changing a flat field", () => {
    const grid = solidGrid(0.25, 0.5, 0.75);
    boxBlurLinear(grid, new Float32Array(grid.length), DISPLAY_W, DISPLAY_H, 2, 3);
    expect(grid[0]).toBeCloseTo(0.25, 5);
    expect(grid[grid.length - 1]).toBeCloseTo(0.75, 5);
  });

  it("keeps a sharp edge from reaching the glow as a hard line", () => {
    const grid = new Float32Array(CELLS * 3);
    for (let y = 0; y < DISPLAY_H; y += 1) {
      for (let x = DISPLAY_W / 2; x < DISPLAY_W; x += 1) grid[(y * DISPLAY_W + x) * 3] = 1;
    }
    boxBlurLinear(grid, new Float32Array(grid.length), DISPLAY_W, DISPLAY_H, 2, 3);
    let largestStep = 0;
    for (let x = 1; x < DISPLAY_W; x += 1) {
      largestStep = Math.max(largestStep, Math.abs(grid[x * 3]! - grid[(x - 1) * 3]!));
    }
    expect(largestStep).toBeLessThan(0.2);
  });

  it("uses Android's tau, and the same time constant at any tick rate", () => {
    expect(smoothingAlpha(600)).toBeCloseTo(1 - Math.exp(-1), 5);
    const stepped = (ticks: number, dt: number) => {
      const current = new Float32Array([0]);
      const target = new Float32Array([1]);
      for (let i = 0; i < ticks; i += 1) step(current, target, smoothingAlpha(dt));
      return current[0]!;
    };
    expect(stepped(10, 60)).toBeCloseTo(stepped(30, 20), 4);
  });

  it("has no snap: a black to white cut moves gradually, and a 3 Hz strobe stays small", () => {
    const pipeline = new AmbientPipeline();
    pipeline.offerFrame(solidFrame(0, 0, 0));
    pipeline.advance(60);
    pipeline.offerFrame(solidFrame(255, 255, 255));
    const out = new Uint8ClampedArray(CELLS * 4);
    pipeline.advance(60);
    pipeline.encode(out, { variant: "dark", intensity: 60 });
    expect(out[0]).toBeLessThan(linearToSrgb(0.28 * 0.1));

    const current = new Float32Array([0.5]);
    let low = 1;
    let high = 0;
    for (let t = 0; t < 6000; t += 60) {
      const target = new Float32Array([Math.floor(t / 166) % 2]);
      step(current, target, smoothingAlpha(60));
      if (t > 3000) {
        low = Math.min(low, current[0]!);
        high = Math.max(high, current[0]!);
      }
    }
    // The input swings by 1. Flashing at this rate leaves under a quarter of that at the real tick.
    expect(high - low).toBeLessThan(0.25);
  });

  it("settles and stops asking to redraw", () => {
    const pipeline = new AmbientPipeline();
    pipeline.offerFrame(solidFrame(200, 40, 40));
    expect(pipeline.advance(60)).toBe(true);
    pipeline.offerFrame(solidFrame(40, 40, 200));
    let moves = 0;
    while (pipeline.advance(60) && moves < 500) moves += 1;
    expect(moves).toBeGreaterThan(5);
    expect(moves).toBeLessThan(500);
    expect(pipeline.advance(60)).toBe(false);
  });

  it("ignores small changes but lets a slow fade add up", () => {
    const pipeline = new AmbientPipeline();
    expect(pipeline.offerFrame(solidFrame(100, 100, 100))).toBe(true);
    expect(pipeline.offerFrame(solidFrame(100 + FRAME_CHANGE_THRESHOLD - 1, 100, 100 + FRAME_CHANGE_THRESHOLD - 1))).toBe(false);
    expect(pipeline.offerFrame(solidFrame(102, 102, 102))).toBe(false);
    expect(pipeline.offerFrame(solidFrame(104, 104, 104))).toBe(true);
    expect(meanAbsDiff(solidFrame(9, 9, 9), solidFrame(1, 1, 1))).toBe(8);
  });

  it("applies Android's gain at the default intensity, opaque", () => {
    const out = new Uint8ClampedArray(CELLS * 4);
    encodeDark(solidGrid(1, 1, 1), out, 60);
    expect(out[0]).toBe(linearToSrgb(0.28));
    expect(out[3]).toBe(255);
    encodeDark(solidGrid(1, 1, 1), out, 30);
    expect(out[0]).toBe(linearToSrgb(0.14));
  });
});

describe("ambient light look", () => {
  const encode = (r: number, g: number, b: number, intensity = 60) => {
    const out = new Uint8ClampedArray(CELLS * 4);
    encodeLight(solidGrid(r, g, b), out, intensity);
    return out;
  };

  it("leaves black, grey and white to the page, so there is no dark smudge", () => {
    expect(encode(0, 0, 0)[3]).toBe(0);
    expect(encode(0.2, 0.2, 0.2)[3]).toBe(0);
    expect(encode(1, 1, 1)[3]).toBe(0);
  });

  it("keeps a dim saturated color at full brightness", () => {
    const out = encode(0.08, 0.01, 0.01);
    expect(out[0]).toBe(255);
    expect(out[1]).toBeLessThan(90);
    expect(out[3]).toBeGreaterThan(100);
  });

  it("scales with the intensity slider", () => {
    expect(encode(1, 0, 0, 30)[3]).toBeLessThan(encode(1, 0, 0, 60)[3]!);
    expect(encode(1, 0, 0, 100)[3]).toBeGreaterThan(encode(1, 0, 0, 60)[3]!);
  });
});

describe("parseAmbientIntensity", () => {
  it("reads the slider's range and falls back to the default", () => {
    expect(parseAmbientIntensity("10")).toBe(10);
    expect(parseAmbientIntensity("100")).toBe(100);
    expect(parseAmbientIntensity("5")).toBe(60);
    expect(parseAmbientIntensity(undefined)).toBe(60);
    expect(parseAmbientIntensity("nope")).toBe(60);
  });
});

describe("ambient settings", () => {
  const definition = (key: string) => SETTING_DEFINITIONS.find((item) => item.key === key);

  it("leaves the glow around the player off by default", () => {
    expect(definition(SETTINGS.AMBIENT_GLOW_ENABLED)?.defaultValue).toBe("false");
  });

  it("gives the slider a floor, since the switch is what turns it off", () => {
    expect(definition(SETTINGS.AMBIENT_MODE_INTENSITY)?.min).toBe(10);
    expect(definition(SETTINGS.AMBIENT_MODE_INTENSITY)?.max).toBe(100);
  });
});
