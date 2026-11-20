import { describe, expect, it } from "vitest";

import { controlsShade, controlsShadeClasses } from "./controlsShade";

describe("controlsShade", () => {
  it("reads the setting and keeps the standard shade by default", () => {
    expect(controlsShade("light")).toBe("light");
    expect(controlsShade("off")).toBe("off");
    expect(controlsShade(undefined)).toBe("standard");
    expect(controlsShade("dark")).toBe("standard");
  });
});

describe("controlsShadeClasses", () => {
  it("draws a band for standard and light, lighter for light", () => {
    expect(controlsShadeClasses("standard").scrim).toBe("from-chrome-black/70 via-chrome-black/25");
    expect(controlsShadeClasses("light").scrim).toBe("from-chrome-black/45 via-chrome-black/15");
  });

  it("drops the band when off and gives every control a darker backing instead", () => {
    const off = controlsShadeClasses("off");
    expect(off.scrim).toBeNull();
    expect(off.pill).toBe("bg-chrome-black/45");
    expect(off.bare).toBe("bg-chrome-black/45");
    expect(off.title).toBe("bg-chrome-black/45");
    expect(off.track).toContain("ring-chrome-black/30");
    expect(controlsShadeClasses("standard").bare).toBeNull();
  });

  it("puts a backing behind the title only once the band no longer darkens it enough", () => {
    expect(controlsShadeClasses("standard").title).toBeNull();
    expect(controlsShadeClasses("light").title).toBe("bg-chrome-black/30");
  });
});
