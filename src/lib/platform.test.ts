import { afterEach, describe, expect, it, vi } from "vitest";

async function platformFor(userAgent: string) {
  vi.resetModules();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  return import("./platform");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hoverMotion", () => {
  const lift = "transition-transform duration-300 hover:translate-y-[-2px]";

  it("keeps the classes where the web view animates a transform cheaply", async () => {
    const { hoverMotion } = await platformFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(hoverMotion(lift)).toBe(lift);
  });

  it("drops them on WebKitGTK, where the element would be lifted into its own layer", async () => {
    const { hoverMotion } = await platformFor("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15");
    expect(hoverMotion(lift)).toBe("");
  });
});
