import { describe, expect, it } from "vitest";
import { canPinWindows, formatGraphics, type GraphicsReport } from "./graphicsReport";

const report: GraphicsReport = {
  tier: 0,
  tierReason: "default",
  renderPath: "gpu",
  faster: "none",
  mode: "automatic",
  session: "x11",
  x11Backend: false,
  packaging: "appimage",
  webkitgtk: "2.48.3",
  decoders: "bundled: H.264 present, VP9 present, AV1 present, OpenH264 absent, VA present, NVDEC absent",
};

describe("formatGraphics", () => {
  it("names the tier, why, the session and the build", () => {
    expect(formatGraphics(report)).toBe("Tier 0 (default), GPU, Automatic mode, x11, appimage, WebKitGTK 2.48.3");
  });

  it("says when a Wayland session is drawn through X11", () => {
    expect(
      formatGraphics({ ...report, tier: 3, tierReason: "settings", renderPath: "software", mode: "safe", session: "wayland", x11Backend: true }),
    ).toBe("Tier 3 (from Graphics compatibility in Settings), no GPU, Safe mode, wayland drawn through X11, appimage, WebKitGTK 2.48.3");
  });

  it("keeps a reason it does not know rather than hiding it", () => {
    expect(formatGraphics({ ...report, tierReason: "new-rule", session: "" })).toContain("Tier 0 (new-rule), GPU, Automatic mode, unknown session");
  });

  it("names the slower paths and where a remembered tier came from", () => {
    expect(formatGraphics({ ...report, tier: 1, tierReason: "trial-kept", renderPath: "shared-memory" })).toContain(
      "Tier 1 (kept after a faster graphics trial), GPU through shared memory,",
    );
    expect(formatGraphics({ ...report, tier: 2, tierReason: "crash-loop", renderPath: "software" })).toContain(
      "Tier 2 (after the page kept crashing), no GPU,",
    );
  });
});

describe("canPinWindows", () => {
  it("allows pinning off Linux and on X11", () => {
    expect(canPinWindows(null)).toBe(true);
    expect(canPinWindows({ ...report, session: "x11" })).toBe(true);
  });

  it("allows pinning when Wayland is drawn through X11", () => {
    expect(canPinWindows({ ...report, session: "wayland", x11Backend: true })).toBe(true);
  });

  it("hides pinning on native Wayland", () => {
    expect(canPinWindows({ ...report, session: "wayland", x11Backend: false })).toBe(false);
  });
});
