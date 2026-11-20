import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: vi.fn(() => Promise.resolve()) }) }));

import { readInterfaceZoom, stepInterfaceZoom } from "./interfaceZoom";

describe("interface zoom", () => {
  it("steps through browser sizes and stops at the ends", () => {
    expect(stepInterfaceZoom(1, 1)).toBe(1.1);
    expect(stepInterfaceZoom(1, -1)).toBe(0.9);
    expect(stepInterfaceZoom(2, 1)).toBe(2);
    expect(stepInterfaceZoom(0.67, -1)).toBe(0.67);
    expect(stepInterfaceZoom(1.5, 0)).toBe(1);
  });

  it("falls back to actual size for anything it can't use", () => {
    expect(readInterfaceZoom("1.25")).toBe(1.25);
    expect(readInterfaceZoom("9")).toBe(1);
    expect(readInterfaceZoom(undefined)).toBe(1);
  });
});
