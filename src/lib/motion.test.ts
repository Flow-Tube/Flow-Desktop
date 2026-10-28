import { afterEach, describe, expect, it, vi } from "vitest";
import { motionMs, parseDurationMs, playExitGhost } from "./motion";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--motion-menu-out");
  document.body.innerHTML = "";
});

describe("parseDurationMs", () => {
  it("reads milliseconds and seconds", () => {
    expect(parseDurationMs("150ms")).toBe(150);
    expect(parseDurationMs(" 0.1s ")).toBe(100);
    expect(parseDurationMs("0ms")).toBe(0);
  });

  it("rejects anything that is not a duration", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("fast")).toBeNull();
    expect(parseDurationMs("150")).toBeNull();
  });
});

describe("motionMs", () => {
  it("follows the CSS token", () => {
    mockReducedMotion(false);
    document.documentElement.style.setProperty("--motion-menu-out", "240ms");
    expect(motionMs("--motion-menu-out")).toBe(240);
  });

  it("falls back to the plan value when the token is missing", () => {
    mockReducedMotion(false);
    expect(motionMs("--motion-menu-out")).toBe(100);
  });

  it("is zero under reduced motion", () => {
    mockReducedMotion(true);
    expect(motionMs("--motion-page")).toBe(0);
  });
});

describe("playExitGhost", () => {
  it("adds nothing under reduced motion", () => {
    mockReducedMotion(true);
    const node = document.createElement("div");
    document.body.appendChild(node);
    playExitGhost(node);
    expect(document.body.children).toHaveLength(1);
  });
});
